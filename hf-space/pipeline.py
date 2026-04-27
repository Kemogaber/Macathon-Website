"""Table extraction pipeline — port of the Final_Phase_Submission notebook.

Three stages:
  1. Yolo            → table detection (returns crops + abs bboxes)
  2. TSR             → table-transformer cell mapping with spanning-cell logic
  3. DetailedOCR     → single-shot PaddleOCR on the whole table crop

`refine_table_structure` then maps each OCR text region to the best TSR cell
via inclusion-ratio, and emits cells with row/col/rowspan/colspan/text.

The HTTP `extract(image_bytes)` entry point preserves the original API
contract: {html, csv, table_count, processing_time_ms, detections}.
"""
import io
import json
import time
import gc
import csv as _csv
import copy

import cv2
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image
from torchvision import transforms
from huggingface_hub import hf_hub_download
from transformers import (
    TableTransformerConfig,
    TableTransformerForObjectDetection,
)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
YOLO_REPO_ID = "kemogaber/macathon-table-detector"
YOLO_FILENAME = "best.pt"
TSR_MODEL_ID = "microsoft/table-transformer-structure-recognition-v1.1-all"


# ---------------------------------------------------------------------------
# Yolo (table detection)
# ---------------------------------------------------------------------------
class Yolo:
    def __init__(self, conf=0.25, iou=0.3, agnostic_nms=True, max_det=300, imgsz=800):
        from ultralytics import YOLO
        weights_path = hf_hub_download(repo_id=YOLO_REPO_ID, filename=YOLO_FILENAME)
        self.model = YOLO(weights_path)
        self.conf = conf
        self.iou = iou
        self.agnostic_nms = agnostic_nms
        self.max_det = max_det
        self.imgsz = imgsz

    def predict(self, image_bgr: np.ndarray) -> dict:
        results_list = self.model(
            image_bgr,
            conf=self.conf,
            iou=self.iou,
            agnostic_nms=self.agnostic_nms,
            max_det=self.max_det,
            imgsz=self.imgsz,
        )
        if not results_list:
            return {"bbox_xyxy": [], "crops": [], "confidences": []}

        result = results_list[0]
        if result.boxes is None or len(result.boxes.xyxy) == 0:
            return {"bbox_xyxy": [], "crops": [], "confidences": []}

        crops, int_boxes, confs = [], [], []
        for box, conf in zip(result.boxes.xyxy, result.boxes.conf):
            x1, y1, x2, y2 = map(int, box.tolist())
            crops.append(result.orig_img[y1:y2, x1:x2])
            int_boxes.append([x1, y1, x2, y2])
            confs.append(float(conf))
        return {"bbox_xyxy": int_boxes, "crops": crops, "confidences": confs}


# ---------------------------------------------------------------------------
# TSR (table structure recognition)
# ---------------------------------------------------------------------------
def _load_tsr_config() -> TableTransformerConfig:
    # The published v1.1 config has `"dilation": null`, but TableTransformerConfig
    # types the field as bool. Newer huggingface_hub strict-dataclass validation
    # rejects that with StrictDataclassFieldValidationError. Patch the dict in
    # place before constructing the config object.
    config_path = hf_hub_download(repo_id=TSR_MODEL_ID, filename="config.json")
    with open(config_path) as f:
        cfg = json.load(f)
    if cfg.get("dilation") is None:
        cfg["dilation"] = False
    return TableTransformerConfig(**cfg)


class TSR:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

        # Native PyTorch normalization constants (ImageNet)
        self.image_mean = [0.485, 0.456, 0.406]
        self.image_std = [0.229, 0.224, 0.225]

        # Standard Resize bounds for TATR DETR
        self.min_size = 800
        self.max_size = 1333

        self.model = (
            TableTransformerForObjectDetection.from_pretrained(
                TSR_MODEL_ID, config=_load_tsr_config()
            )
            .to(self.device)
            .eval()
        )

    def _preprocess_image(self, image: Image.Image) -> torch.Tensor:
        w, h = image.size
        scale = self.min_size / min(w, h)
        if max(w, h) * scale > self.max_size:
            scale = self.max_size / max(w, h)
        new_w = int(w * scale)
        new_h = int(h * scale)

        transform = transforms.Compose([
            transforms.Resize((new_h, new_w)),
            transforms.ToTensor(),
            transforms.Normalize(mean=self.image_mean, std=self.image_std),
        ])
        return transform(image).unsqueeze(0).to(self.device)

    def _post_process_bboxes(self, out_logits, out_bbox, target_size, threshold):
        prob = F.softmax(out_logits, -1)
        scores, labels = prob[..., :-1].max(-1)

        # Decode center coordinates to corner edges
        boxes = out_bbox.clone()
        x_c, y_c, w, h = boxes.unbind(-1)
        b = [(x_c - 0.5 * w), (y_c - 0.5 * h), (x_c + 0.5 * w), (y_c + 0.5 * h)]
        boxes = torch.stack(b, dim=-1)

        # Scale back to original resolution
        img_w, img_h = target_size
        scale_fct = torch.tensor(
            [img_w, img_h, img_w, img_h], dtype=torch.float32, device=self.device
        )
        boxes = boxes * scale_fct[None, :]

        keep = scores > threshold
        return (
            scores[keep].cpu().tolist(),
            labels[keep].cpu().tolist(),
            boxes[keep].cpu().tolist(),
        )

    @staticmethod
    def _intersection(box1, box2):
        x1 = max(box1[0], box2[0])
        y1 = max(box1[1], box2[1])
        x2 = min(box1[2], box2[2])
        y2 = min(box1[3], box2[3])
        if x1 < x2 and y1 < y2:
            return [x1, y1, x2, y2]
        return None

    @staticmethod
    def _overlap_ratio(box1, box2):
        inter = TSR._intersection(box1, box2)
        if not inter:
            return 0.0
        inter_area = (inter[2] - inter[0]) * (inter[3] - inter[1])
        box1_area = (box1[2] - box1[0]) * (box1[3] - box1[1])
        return inter_area / box1_area if box1_area > 0 else 0.0

    def predict(self, table_crop_bgr: np.ndarray, table_bbox_abs, threshold=0.5) -> dict:
        image = Image.fromarray(
            cv2.cvtColor(table_crop_bgr, cv2.COLOR_BGR2RGB)
        ).convert("RGB")
        w, h = image.size

        with torch.no_grad():
            pixel_values = self._preprocess_image(image)
            outputs = self.model(pixel_values=pixel_values)
            _, labels, boxes = self._post_process_bboxes(
                out_logits=outputs.logits[0],
                out_bbox=outputs.pred_boxes[0],
                target_size=(w, h),
                threshold=threshold,
            )

        # 1: 'table column', 2: 'table row',
        # 4: 'projected row header', 5: 'spanning cell'
        rows = sorted(
            [box for label, box in zip(labels, boxes) if label == 2],
            key=lambda b: b[1],
        )
        columns = sorted(
            [box for label, box in zip(labels, boxes) if label == 1],
            key=lambda b: b[0],
        )
        spanning_cells = [
            box for label, box in zip(labels, boxes) if label in (4, 5)
        ]

        final_cells = []
        spanning_intersections = [[] for _ in spanning_cells]

        # Map row × column intersections, divert to spanning cells when overlap > 0.5
        for r_idx, row in enumerate(rows):
            for c_idx, col in enumerate(columns):
                inter = self._intersection(row, col)
                if inter is None:
                    continue
                assigned = False
                for span_idx, span in enumerate(spanning_cells):
                    if self._overlap_ratio(inter, span) > 0.5:
                        spanning_intersections[span_idx].append((r_idx, c_idx))
                        assigned = True
                        break
                if not assigned:
                    final_cells.append({
                        "bbox": inter,
                        "row": r_idx,
                        "col": c_idx,
                        "rowspan": 1,
                        "colspan": 1,
                    })

        for span_idx, span in enumerate(spanning_cells):
            inters = spanning_intersections[span_idx]
            if inters:
                rs = [r for r, _ in inters]
                cs = [c for _, c in inters]
                final_cells.append({
                    "bbox": span,
                    "row": min(rs),
                    "col": min(cs),
                    "rowspan": max(rs) - min(rs) + 1,
                    "colspan": max(cs) - min(cs) + 1,
                })

        # Shift cells to absolute image coords
        x1, y1, _, _ = table_bbox_abs
        for cell in final_cells:
            cx1, cy1, cx2, cy2 = cell["bbox"]
            cell["bbox"] = [cx1 + x1, cy1 + y1, cx2 + x1, cy2 + y1]

        return {
            "table_id": 0,
            "bbox": list(table_bbox_abs),
            "cells": final_cells,
        }


# ---------------------------------------------------------------------------
# DetailedOCR (single-shot OCR on full table crop)
# ---------------------------------------------------------------------------
class DetailedOCR:
    MIN_SIDE = 32   # tiny crops are upscaled to at least this on each side
    SCALE = 2.5     # upscale factor for crops smaller than 64 px

    def __init__(self):
        from paddleocr import PaddleOCR
        # enable_mkldnn=False routes PaddleX away from its default oneDNN
        # run_mode, which crashes paddle 3.3's PIR executor with
        # NotImplementedError on `pir::ArrayAttribute<DoubleAttribute>`.
        self.model = PaddleOCR(
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            lang="en",
            enable_mkldnn=False,
        )

    def predict(self, crop_bgr: np.ndarray) -> list[dict]:
        if crop_bgr is None or crop_bgr.size == 0:
            return []

        crop_rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
        h, w = crop_rgb.shape[:2]
        scale_x, scale_y = 1.0, 1.0

        if h < self.MIN_SIDE or w < self.MIN_SIDE:
            new_w, new_h = max(w, self.MIN_SIDE), max(h, self.MIN_SIDE)
            crop_rgb = cv2.resize(crop_rgb, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
            scale_x, scale_y = new_w / w, new_h / h
        elif h < 64 or w < 64:
            new_w, new_h = int(w * self.SCALE), int(h * self.SCALE)
            crop_rgb = cv2.resize(crop_rgb, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
            scale_x, scale_y = new_w / w, new_h / h

        try:
            raw_results = self.model.ocr(crop_rgb)
        except Exception as e:
            print(f"OCR predict error: {e}")
            return []

        parsed: list[dict] = []
        if not raw_results:
            print("OCR: raw_results is empty")
            return parsed

        for res in raw_results:
            if res is None:
                continue

            # PaddleOCR 3.x OCRResult: data may be exposed via attribute access
            # (`res.rec_texts`) on some builds, dict-style (`res["rec_texts"]`)
            # on others. Try both before falling through to the legacy parser.
            texts = getattr(res, "rec_texts", None)
            polys = getattr(res, "rec_polys", None)
            if (texts is None or polys is None) and isinstance(res, dict):
                texts = texts if texts is not None else res.get("rec_texts")
                polys = polys if polys is not None else res.get("rec_polys")

            if texts is not None and polys is not None:
                for text, poly in zip(texts, polys):
                    if text and poly is not None:
                        parsed.append(
                            self._poly_to_entry(text, poly, scale_x, scale_y)
                        )
                continue

            # Legacy v2 list-style result: [[poly, (text, conf)], ...]
            if isinstance(res, list):
                for line in res:
                    if isinstance(line, list) and len(line) == 2:
                        poly = line[0]
                        text_conf = line[1]
                        if isinstance(text_conf, (tuple, list)):
                            text = text_conf[0]
                            if text and poly is not None:
                                parsed.append(
                                    self._poly_to_entry(text, poly, scale_x, scale_y)
                                )
                continue

            # Last resort — log what we got so we can adapt
            print(
                f"OCR: unrecognized result type={type(res).__name__} "
                f"keys={list(res.keys()) if isinstance(res, dict) else 'n/a'} "
                f"attrs={[a for a in dir(res) if 'rec_' in a]}"
            )

        print(f"OCR: parsed {len(parsed)} text regions from {len(raw_results)} result(s)")
        return parsed

    @staticmethod
    def _poly_to_entry(text, poly, scale_x, scale_y) -> dict:
        poly_np = np.array(poly).astype(float)
        x_coords = poly_np[:, 0]
        y_coords = poly_np[:, 1]
        x1 = float(np.min(x_coords) / scale_x)
        y1 = float(np.min(y_coords) / scale_y)
        x2 = float(np.max(x_coords) / scale_x)
        y2 = float(np.max(y_coords) / scale_y)
        return {"text": text, "bbox_xyxy": [x1, y1, x2, y2]}


# ---------------------------------------------------------------------------
# refine_table_structure (TSR cells + OCR detections → cells with text)
# ---------------------------------------------------------------------------
def _calculate_1d_overlap(min1, max1, min2, max2) -> float:
    overlap = max(0, min(max1, max2) - max(min1, min2))
    return overlap / ((max1 - min1) + 1e-6)


def refine_table_structure(tsr_cells: list[dict], ocr_detections: list[dict]) -> list[dict]:
    refined: list[dict] = []
    working = copy.deepcopy(tsr_cells)
    cell_text_map: dict[int, list[tuple[str, list[float]]]] = {
        i: [] for i in range(len(working))
    }
    unassigned: list[dict] = []

    # 1:1 OCR → best TSR cell by inclusion ratio
    for det in ocr_detections:
        ocr_box = det["bbox_xyxy"]
        best_idx, best = -1, 0.0

        for i, cell in enumerate(working):
            cb = cell["bbox"]
            xA = max(ocr_box[0], cb[0])
            yA = max(ocr_box[1], cb[1])
            xB = min(ocr_box[2], cb[2])
            yB = min(ocr_box[3], cb[3])
            inter_area = max(0, xB - xA) * max(0, yB - yA)
            ocr_area = (ocr_box[2] - ocr_box[0]) * (ocr_box[3] - ocr_box[1])
            ratio = inter_area / (ocr_area + 1e-6)
            if ratio > best and ratio > 0.1:
                best = ratio
                best_idx = i

        if best_idx >= 0:
            cell_text_map[best_idx].append((det["text"], ocr_box))
        else:
            unassigned.append(det)

    # Compute row/col intervals for inferring missing cells
    row_intervals: dict[int, list[float]] = {}
    col_intervals: dict[int, list[float]] = {}
    for cell in working:
        r, c = cell.get("row"), cell.get("col")
        if r is None or c is None:
            continue
        box = cell["bbox"]
        if r not in row_intervals:
            row_intervals[r] = [box[1], box[3]]
        else:
            row_intervals[r][0] = min(row_intervals[r][0], box[1])
            row_intervals[r][1] = max(row_intervals[r][1], box[3])
        if c not in col_intervals:
            col_intervals[c] = [box[0], box[2]]
        else:
            col_intervals[c][0] = min(col_intervals[c][0], box[0])
            col_intervals[c][1] = max(col_intervals[c][1], box[2])

    # Finalize TSR cells with assigned text
    for i, cell in enumerate(working):
        assigned = cell_text_map[i]
        assigned.sort(key=lambda x: (x[1][1], x[1][0]))   # top-down, left-right
        cell["text"] = " ".join(t for t, _ in assigned).strip()
        refined.append(cell)

    # Infer rows/cols for unassigned OCR text
    for det in unassigned:
        box = det["bbox_xyxy"]

        matched_rows = [
            r for r, (y1, y2) in row_intervals.items()
            if _calculate_1d_overlap(box[1], box[3], y1, y2) > 0.1
        ]
        matched_cols = [
            c for c, (x1, x2) in col_intervals.items()
            if _calculate_1d_overlap(box[0], box[2], x1, x2) > 0.1
        ]

        if not matched_rows:
            if not row_intervals:
                matched_rows = [0]
            else:
                closest_r = min(
                    row_intervals.keys(),
                    key=lambda r: min(
                        abs(box[1] - row_intervals[r][1]),
                        abs(box[3] - row_intervals[r][0]),
                    ),
                )
                matched_rows = [closest_r]

        if not matched_cols:
            if not col_intervals:
                matched_cols = [0]
            else:
                closest_c = min(
                    col_intervals.keys(),
                    key=lambda c: min(
                        abs(box[0] - col_intervals[c][1]),
                        abs(box[2] - col_intervals[c][0]),
                    ),
                )
                matched_cols = [closest_c]

        target_row = min(matched_rows)
        target_col = min(matched_cols)
        refined.append({
            "bbox": box,
            "row": target_row,
            "col": target_col,
            "rowspan": max(matched_rows) - target_row + 1,
            "colspan": max(matched_cols) - target_col + 1,
            "text": det["text"],
        })

    return refined


# ---------------------------------------------------------------------------
# Output formatters (preserve API contract: html + csv strings)
# ---------------------------------------------------------------------------
def _refined_to_html(cells: list[dict]) -> str:
    if not cells:
        return "<p>No table data extracted.</p>"

    max_row = max(c["row"] + c.get("rowspan", 1) for c in cells)
    max_col = max(c["col"] + c.get("colspan", 1) for c in cells)
    occupied = [[False] * max_col for _ in range(max_row)]
    cell_at: dict[tuple[int, int], dict] = {}
    for c in cells:
        cell_at.setdefault((c["row"], c["col"]), c)

    rows_html: list[str] = []
    for r in range(max_row):
        cells_html: list[str] = []
        for col in range(max_col):
            if occupied[r][col]:
                continue
            c = cell_at.get((r, col))
            if not c:
                cells_html.append("<td></td>")
                continue
            rs = c.get("rowspan", 1)
            cs = c.get("colspan", 1)
            for dr in range(rs):
                for dc in range(cs):
                    if r + dr < max_row and col + dc < max_col:
                        occupied[r + dr][col + dc] = True
            attrs = []
            if rs > 1:
                attrs.append(f'rowspan="{rs}"')
            if cs > 1:
                attrs.append(f'colspan="{cs}"')
            attr_str = (" " + " ".join(attrs)) if attrs else ""
            tag = "th" if r == 0 else "td"
            text = c.get("text", "") or ""
            cells_html.append(f"<{tag}{attr_str}>{text}</{tag}>")
        rows_html.append("<tr>" + "".join(cells_html) + "</tr>")

    body = "\n  ".join(rows_html)
    return (
        '<table border="1" cellpadding="6" cellspacing="0" '
        'style="border-collapse:collapse">\n  '
        f"{body}\n</table>"
    )


def _refined_to_csv(cells: list[dict]) -> str:
    if not cells:
        return ""
    max_row = max(c["row"] + c.get("rowspan", 1) for c in cells)
    max_col = max(c["col"] + c.get("colspan", 1) for c in cells)
    grid = [[""] * max_col for _ in range(max_row)]
    for c in cells:
        if c["row"] < max_row and c["col"] < max_col:
            grid[c["row"]][c["col"]] = c.get("text", "") or ""
    buf = io.StringIO()
    writer = _csv.writer(buf)
    for row in grid:
        writer.writerow(row)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------
class TableExtractionPipeline:
    _instance = None  # module-level singleton

    def __init__(self):
        self.yolo = Yolo()
        self.tsr = TSR()
        self.ocr = DetailedOCR()

    def extract(self, image_bytes: bytes) -> dict:
        t0 = time.monotonic()

        nparr = np.frombuffer(image_bytes, np.uint8)
        image_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image_bgr is None:
            return {
                "html": "<p>Could not decode image.</p>",
                "csv": "",
                "table_count": 0,
                "processing_time_ms": 0,
                "detections": [],
            }

        yolo_out = self.yolo.predict(image_bgr)
        crops = yolo_out["crops"]
        bboxes = yolo_out["bbox_xyxy"]
        confs = yolo_out.get("confidences", [1.0] * len(crops))

        all_tables: list[dict] = []
        for crop, bbox in zip(crops, bboxes):
            if crop is None or crop.size == 0:
                continue

            tsr_table = self.tsr.predict(crop, bbox)
            if not tsr_table.get("cells"):
                continue

            ocr_rel = self.ocr.predict(crop)

            tx1, ty1 = bbox[0], bbox[1]
            ocr_abs = [
                {
                    "text": d["text"],
                    "bbox_xyxy": [
                        d["bbox_xyxy"][0] + tx1,
                        d["bbox_xyxy"][1] + ty1,
                        d["bbox_xyxy"][2] + tx1,
                        d["bbox_xyxy"][3] + ty1,
                    ],
                }
                for d in ocr_rel
            ]

            tsr_table["cells"] = refine_table_structure(tsr_table["cells"], ocr_abs)
            all_tables.append(tsr_table)

        if not all_tables:
            html = "<p>No tables detected.</p>"
            csv_str = ""
        elif len(all_tables) == 1:
            html = _refined_to_html(all_tables[0]["cells"])
            csv_str = _refined_to_csv(all_tables[0]["cells"])
        else:
            parts_html, parts_csv = [], []
            for i, t in enumerate(all_tables, 1):
                parts_html.append(f"<h4>Table {i}</h4>" + _refined_to_html(t["cells"]))
                parts_csv.append(f"# Table {i}\n" + _refined_to_csv(t["cells"]))
            html = "\n".join(parts_html)
            csv_str = "\n".join(parts_csv)

        elapsed_ms = int((time.monotonic() - t0) * 1000)
        gc.collect()

        return {
            "html": html,
            "csv": csv_str,
            "table_count": len(all_tables),
            "processing_time_ms": elapsed_ms,
            "detections": [
                {"bbox": b, "confidence": round(c, 3)}
                for b, c in zip(bboxes, confs)
            ],
            # Structured per-table data: list of
            # {table_id, bbox, cells: [{bbox, row, col, rowspan, colspan, text}]}
            "tables": all_tables,
        }


def get_pipeline() -> TableExtractionPipeline:
    if TableExtractionPipeline._instance is None:
        TableExtractionPipeline._instance = TableExtractionPipeline()
    return TableExtractionPipeline._instance
