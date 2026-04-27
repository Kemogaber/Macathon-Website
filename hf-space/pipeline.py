"""Decomposed table extraction pipeline.

Two entry points:
  - detect_boxes(image_bgr)      → axis-aligned table bboxes + scores (YOLO only)
  - recognize_quad(image_bgr, q) → perspective-warp the quad, run TSR + OCR,
                                   return cells + html + csv + warped crop.

The full one-shot extract(image_bytes) entry point is kept for back-compat.
"""
from __future__ import annotations

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


YOLO_REPO_ID = "kemogaber/macathon-table-detector"
YOLO_FILENAME = "best.pt"
TSR_MODEL_ID = "microsoft/table-transformer-structure-recognition-v1.1-all"


# ---------------------------------------------------------------------------
# Yolo
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
            return {"bbox_xyxy": [], "confidences": []}

        result = results_list[0]
        if result.boxes is None or len(result.boxes.xyxy) == 0:
            return {"bbox_xyxy": [], "confidences": []}

        boxes, confs = [], []
        for box, conf in zip(result.boxes.xyxy, result.boxes.conf):
            x1, y1, x2, y2 = map(int, box.tolist())
            boxes.append([x1, y1, x2, y2])
            confs.append(float(conf))
        return {"bbox_xyxy": boxes, "confidences": confs}


# ---------------------------------------------------------------------------
# TSR
# ---------------------------------------------------------------------------
def _load_tsr_config() -> TableTransformerConfig:
    config_path = hf_hub_download(repo_id=TSR_MODEL_ID, filename="config.json")
    with open(config_path) as f:
        cfg = json.load(f)
    if cfg.get("dilation") is None:
        cfg["dilation"] = False
    return TableTransformerConfig(**cfg)


class TSR:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.image_mean = [0.485, 0.456, 0.406]
        self.image_std = [0.229, 0.224, 0.225]
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
        boxes = out_bbox.clone()
        x_c, y_c, w, h = boxes.unbind(-1)
        b = [(x_c - 0.5 * w), (y_c - 0.5 * h), (x_c + 0.5 * w), (y_c + 0.5 * h)]
        boxes = torch.stack(b, dim=-1)
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

    def predict(self, table_crop_bgr: np.ndarray, threshold: float = 0.5) -> list[dict]:
        """TSR on a rectified crop. Returns list of cell dicts in CROP coords."""
        image = Image.fromarray(
            cv2.cvtColor(table_crop_bgr, cv2.COLOR_BGR2RGB)
        ).convert("RGB")
        w, h = image.size

        with torch.no_grad():
            pixel_values = self._preprocess_image(image)
            outputs = self.model(pixel_values=pixel_values)
            scores, labels, boxes = self._post_process_bboxes(
                out_logits=outputs.logits[0],
                out_bbox=outputs.pred_boxes[0],
                target_size=(w, h),
                threshold=threshold,
            )

        rows = sorted(
            [(box, s) for s, label, box in zip(scores, labels, boxes) if label == 2],
            key=lambda bs: bs[0][1],
        )
        columns = sorted(
            [(box, s) for s, label, box in zip(scores, labels, boxes) if label == 1],
            key=lambda bs: bs[0][0],
        )
        spanning = [
            (box, s) for s, label, box in zip(scores, labels, boxes) if label in (4, 5)
        ]

        final_cells: list[dict] = []
        spanning_intersections: list[list[tuple[int, int]]] = [[] for _ in spanning]

        for r_idx, (row, r_score) in enumerate(rows):
            for c_idx, (col, c_score) in enumerate(columns):
                inter = self._intersection(row, col)
                if inter is None:
                    continue
                assigned = False
                for span_idx, (span, _) in enumerate(spanning):
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
                        "tsr_score": float((r_score + c_score) / 2.0),
                    })

        for span_idx, (span, span_score) in enumerate(spanning):
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
                    "tsr_score": float(span_score),
                })

        return final_cells


# ---------------------------------------------------------------------------
# OCR
# ---------------------------------------------------------------------------
class DetailedOCR:
    MIN_SIDE = 32
    SCALE = 2.5

    def __init__(self):
        from paddleocr import PaddleOCR
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
            return parsed

        for res in raw_results:
            if res is None:
                continue

            texts = getattr(res, "rec_texts", None)
            polys = getattr(res, "rec_polys", None)
            scores = getattr(res, "rec_scores", None)
            if isinstance(res, dict):
                texts = texts if texts is not None else res.get("rec_texts")
                polys = polys if polys is not None else res.get("rec_polys")
                scores = scores if scores is not None else res.get("rec_scores")

            if texts is not None and polys is not None:
                if scores is None:
                    scores = [1.0] * len(texts)
                for text, poly, sc in zip(texts, polys, scores):
                    if text and poly is not None:
                        parsed.append(
                            self._poly_to_entry(text, poly, scale_x, scale_y, float(sc))
                        )
                continue

            if isinstance(res, list):
                for line in res:
                    if isinstance(line, list) and len(line) == 2:
                        poly = line[0]
                        text_conf = line[1]
                        if isinstance(text_conf, (tuple, list)):
                            text = text_conf[0]
                            sc = float(text_conf[1]) if len(text_conf) > 1 else 1.0
                            if text and poly is not None:
                                parsed.append(
                                    self._poly_to_entry(text, poly, scale_x, scale_y, sc)
                                )

        return parsed

    @staticmethod
    def _poly_to_entry(text, poly, scale_x, scale_y, score=1.0) -> dict:
        poly_np = np.array(poly).astype(float)
        x_coords = poly_np[:, 0]
        y_coords = poly_np[:, 1]
        x1 = float(np.min(x_coords) / scale_x)
        y1 = float(np.min(y_coords) / scale_y)
        x2 = float(np.max(x_coords) / scale_x)
        y2 = float(np.max(y_coords) / scale_y)
        return {"text": text, "bbox_xyxy": [x1, y1, x2, y2], "score": float(score)}


# ---------------------------------------------------------------------------
# Refine cells with OCR
# ---------------------------------------------------------------------------
def _calculate_1d_overlap(min1, max1, min2, max2) -> float:
    overlap = max(0, min(max1, max2) - max(min1, min2))
    return overlap / ((max1 - min1) + 1e-6)


def refine_table_structure(tsr_cells: list[dict], ocr_detections: list[dict]) -> list[dict]:
    refined: list[dict] = []
    working = copy.deepcopy(tsr_cells)
    cell_text_map: dict[int, list[tuple[str, list[float], float]]] = {
        i: [] for i in range(len(working))
    }
    unassigned: list[dict] = []

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
            cell_text_map[best_idx].append(
                (det["text"], ocr_box, float(det.get("score", 1.0)))
            )
        else:
            unassigned.append(det)

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

    for i, cell in enumerate(working):
        assigned = cell_text_map[i]
        assigned.sort(key=lambda x: (x[1][1], x[1][0]))
        cell["text"] = " ".join(item[0] for item in assigned).strip()
        if assigned and any(len(item) >= 3 for item in assigned):
            ocr_scores = [item[2] for item in assigned if len(item) >= 3]
            cell["ocr_score"] = float(sum(ocr_scores) / len(ocr_scores)) if ocr_scores else 0.0
        else:
            cell["ocr_score"] = 0.0 if assigned else None
        refined.append(cell)

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
            matched_rows = [0] if not row_intervals else [min(
                row_intervals.keys(),
                key=lambda r: min(
                    abs(box[1] - row_intervals[r][1]),
                    abs(box[3] - row_intervals[r][0]),
                ),
            )]
        if not matched_cols:
            matched_cols = [0] if not col_intervals else [min(
                col_intervals.keys(),
                key=lambda c: min(
                    abs(box[0] - col_intervals[c][1]),
                    abs(box[2] - col_intervals[c][0]),
                ),
            )]
        target_row = min(matched_rows)
        target_col = min(matched_cols)
        refined.append({
            "bbox": box,
            "row": target_row,
            "col": target_col,
            "rowspan": max(matched_rows) - target_row + 1,
            "colspan": max(matched_cols) - target_col + 1,
            "text": det["text"],
            "tsr_score": None,
            "ocr_score": float(det.get("score", 1.0)),
        })

    return refined


# ---------------------------------------------------------------------------
# Output formatters
# ---------------------------------------------------------------------------
def refined_to_html(cells: list[dict]) -> str:
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


def refined_to_csv(cells: list[dict]) -> str:
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
# Quad → perspective warp
# ---------------------------------------------------------------------------
def _order_quad(quad: list[list[float]]) -> np.ndarray:
    """Return 4 points ordered as TL, TR, BR, BL."""
    pts = np.array(quad, dtype=np.float32).reshape(4, 2)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).flatten()
    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmin(d)]
    bl = pts[np.argmax(d)]
    return np.array([tl, tr, br, bl], dtype=np.float32)


def warp_quad(image_bgr: np.ndarray, quad: list[list[float]]) -> np.ndarray:
    """Perspective-warp a quadrilateral from `image_bgr` to an axis-aligned rect."""
    src = _order_quad(quad)
    (tl, tr, br, bl) = src
    width = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
    height = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
    width = max(width, 16)
    height = max(height, 16)
    dst = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
        dtype=np.float32,
    )
    M = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(image_bgr, M, (width, height))


# ---------------------------------------------------------------------------
# Pipeline (singleton)
# ---------------------------------------------------------------------------
class TableExtractionPipeline:
    _instance = None

    def __init__(self):
        self.yolo = Yolo()
        self.tsr = TSR()
        self.ocr = DetailedOCR()

    # ---------- new decomposed entry points ----------
    def detect_boxes(self, image_bgr: np.ndarray) -> list[dict]:
        """Run YOLO only. Return [{bbox: [x1,y1,x2,y2], score: float}]."""
        out = self.yolo.predict(image_bgr)
        return [
            {"bbox": b, "score": round(s, 3)}
            for b, s in zip(out["bbox_xyxy"], out["confidences"])
        ]

    def recognize_quad(
        self,
        image_bgr: np.ndarray,
        quad: list[list[float]],
    ) -> dict:
        """Warp the quad, run TSR + OCR + refine. Return cells/html/csv/crop."""
        crop = warp_quad(image_bgr, quad)
        cells = self.tsr.predict(crop)
        if not cells:
            return {
                "cells": [],
                "html": "<p>No table data extracted.</p>",
                "csv": "",
                "crop_bgr": crop,
                "tsr_confidence": 0.0,
                "ocr_confidence": 0.0,
            }
        ocr = self.ocr.predict(crop)
        refined = refine_table_structure(cells, ocr)

        tsr_scores = [c["tsr_score"] for c in refined if c.get("tsr_score") is not None]
        ocr_scores = [c["ocr_score"] for c in refined if c.get("ocr_score")]
        tsr_conf = float(sum(tsr_scores) / len(tsr_scores)) if tsr_scores else 0.0
        ocr_conf = float(sum(ocr_scores) / len(ocr_scores)) if ocr_scores else 0.0

        return {
            "cells": refined,
            "html": refined_to_html(refined),
            "csv": refined_to_csv(refined),
            "crop_bgr": crop,
            "tsr_confidence": round(tsr_conf, 3),
            "ocr_confidence": round(ocr_conf, 3),
        }

    # ---------- legacy one-shot (kept for /api/extract back-compat) ----------
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
            }

        detections = self.detect_boxes(image_bgr)
        all_html: list[str] = []
        all_csv: list[str] = []
        for i, d in enumerate(detections, 1):
            x1, y1, x2, y2 = d["bbox"]
            quad = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
            r = self.recognize_quad(image_bgr, quad)
            if not r["cells"]:
                continue
            all_html.append(f"<h4>Table {i}</h4>" + r["html"])
            all_csv.append(f"# Table {i}\n" + r["csv"])

        elapsed_ms = int((time.monotonic() - t0) * 1000)
        gc.collect()
        return {
            "html": "\n".join(all_html) if all_html else "<p>No tables detected.</p>",
            "csv": "\n".join(all_csv),
            "table_count": len(all_html),
            "processing_time_ms": elapsed_ms,
        }


def get_pipeline() -> TableExtractionPipeline:
    if TableExtractionPipeline._instance is None:
        TableExtractionPipeline._instance = TableExtractionPipeline()
    return TableExtractionPipeline._instance
