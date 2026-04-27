import io
import json
import time
import csv
import torch
import numpy as np
from PIL import Image
from huggingface_hub import hf_hub_download
from transformers import (
    TableTransformerConfig,
    TableTransformerForObjectDetection,
    DetrImageProcessor,
)

# ---------------------------------------------------------------------------
# Config — set your HF repo ID after uploading best.pt
# ---------------------------------------------------------------------------
YOLO_REPO_ID = "kemogaber/macathon-table-detector"   # <-- fill in
YOLO_FILENAME = "best.pt"

TSR_MODEL_ID = "microsoft/table-transformer-structure-recognition-v1.1-all"

DETECTION_THRESHOLD = 0.7
STRUCTURE_THRESHOLD = 0.6

# ---------------------------------------------------------------------------
# Label maps
# ---------------------------------------------------------------------------
TSR_LABELS = {
    0: "table",
    1: "table column",
    2: "table row",
    3: "table column header",
    4: "table projected row header",
    5: "table spanning cell",
    6: "no object",
}


# ---------------------------------------------------------------------------
# Table Detector (YOLOv8)
# ---------------------------------------------------------------------------
class TableDetector:
    def __init__(self):
        from ultralytics import YOLO
        weights_path = hf_hub_download(repo_id=YOLO_REPO_ID, filename=YOLO_FILENAME)
        self.model = YOLO(weights_path)
        self.model.conf = DETECTION_THRESHOLD

    def detect(self, image: Image.Image) -> list[dict]:
        """Returns list of {bbox: [x1,y1,x2,y2], confidence: float}."""
        results = self.model(np.array(image))[0]
        detections = []
        for box in results.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            detections.append({
                "bbox": [int(x1), int(y1), int(x2), int(y2)],
                "confidence": float(box.conf[0]),
            })
        return detections


# ---------------------------------------------------------------------------
# Structure Recognizer (Table Transformer)
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


class StructureRecognizer:
    def __init__(self):
        self.processor = DetrImageProcessor.from_pretrained(
            TSR_MODEL_ID,
            size={"shortest_edge": 800, "longest_edge": 1333},
        )
        self.model = TableTransformerForObjectDetection.from_pretrained(
            TSR_MODEL_ID, config=_load_tsr_config()
        )
        self.model.eval()

    def recognize(self, table_crop: Image.Image) -> dict:
        """
        Returns:
          rows: list of [y1, y2] sorted top-to-bottom
          cols: list of [x1, x2] sorted left-to-right
          cells: list of {row, col, bbox}
        """
        inputs = self.processor(images=table_crop, return_tensors="pt")
        with torch.no_grad():
            outputs = self.model(**inputs)

        target_sizes = torch.tensor([table_crop.size[::-1]])
        results = self.processor.post_process_object_detection(
            outputs, threshold=STRUCTURE_THRESHOLD, target_sizes=target_sizes
        )[0]

        rows, cols = [], []
        for score, label, box in zip(
            results["scores"], results["labels"], results["boxes"]
        ):
            box = box.tolist()
            label_name = TSR_LABELS.get(label.item(), "")
            if label_name == "table row":
                rows.append(box)
            elif label_name == "table column":
                cols.append(box)

        rows = sorted(rows, key=lambda b: b[1])
        cols = sorted(cols, key=lambda b: b[0])

        cells = []
        for r_idx, row in enumerate(rows):
            for c_idx, col in enumerate(cols):
                cell_bbox = [
                    max(row[0], col[0]),
                    max(row[1], col[1]),
                    min(row[2], col[2]),
                    min(row[3], col[3]),
                ]
                if cell_bbox[0] < cell_bbox[2] and cell_bbox[1] < cell_bbox[3]:
                    cells.append({"row": r_idx, "col": c_idx, "bbox": cell_bbox})

        return {"rows": rows, "cols": cols, "cells": cells}


# ---------------------------------------------------------------------------
# OCR Module (PaddleOCR)
# ---------------------------------------------------------------------------
class OCRModule:
    def __init__(self):
        from paddleocr import PaddleOCR
        # enable_mkldnn=False routes PaddleX away from its default oneDNN
        # run_mode, which crashes paddle 3.3's PIR executor with
        # NotImplementedError on `pir::ArrayAttribute<DoubleAttribute>`.
        # Setting FLAGS_use_mkldnn at the env level does NOT help — PaddleX
        # ignores it and consults its own PaddlePredictorOption.run_mode.
        self.ocr = PaddleOCR(use_angle_cls=True, lang="en", enable_mkldnn=False)

    def extract_text(self, cell_crop: Image.Image) -> str:
        """Run OCR on a single cell crop and return text."""
        arr = np.array(cell_crop)
        result = self.ocr.ocr(arr)
        if not result or not result[0]:
            return ""
        lines = [line[1][0] for line in result[0] if line[1][1] > 0.3]
        return " ".join(lines).strip()


# ---------------------------------------------------------------------------
# Grid builder: OCR each cell and assemble a 2D grid
# ---------------------------------------------------------------------------
def _build_grid(table_crop: Image.Image, structure: dict, ocr: OCRModule) -> list[list[str]]:
    if not structure["rows"] or not structure["cols"]:
        return []

    n_rows = len(structure["rows"])
    n_cols = len(structure["cols"])
    grid = [[""] * n_cols for _ in range(n_rows)]

    for cell in structure["cells"]:
        x1, y1, x2, y2 = [int(v) for v in cell["bbox"]]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(table_crop.width, x2), min(table_crop.height, y2)
        if x2 <= x1 or y2 <= y1:
            continue
        crop = table_crop.crop((x1, y1, x2, y2))
        text = ocr.extract_text(crop)
        grid[cell["row"]][cell["col"]] = text

    return grid


# ---------------------------------------------------------------------------
# Output formatters
# ---------------------------------------------------------------------------
def _grid_to_html(grid: list[list[str]]) -> str:
    if not grid:
        return "<p>No table data extracted.</p>"
    rows_html = []
    for i, row in enumerate(grid):
        tag = "th" if i == 0 else "td"
        cells = "".join(f"<{tag}>{cell}</{tag}>" for cell in row)
        rows_html.append(f"<tr>{cells}</tr>")
    body = "\n  ".join(rows_html)
    return (
        '<table border="1" cellpadding="6" cellspacing="0" '
        'style="border-collapse:collapse">\n  '
        f"{body}\n</table>"
    )


def _grid_to_csv(grid: list[list[str]]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    for row in grid:
        writer.writerow(row)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------
class TableExtractionPipeline:
    _instance = None  # module-level singleton so models load once

    def __init__(self):
        self.detector = TableDetector()
        self.recognizer = StructureRecognizer()
        self.ocr = OCRModule()

    def extract(self, image_bytes: bytes) -> dict:
        """
        Main entry point.
        Returns: {html, csv, table_count, processing_time_ms, detections}
        """
        t0 = time.monotonic()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        detections = self.detector.detect(image)

        all_grids: list[list[list[str]]] = []
        for det in detections:
            x1, y1, x2, y2 = det["bbox"]
            crop = image.crop((x1, y1, x2, y2))
            structure = self.recognizer.recognize(crop)
            grid = _build_grid(crop, structure, self.ocr)
            if grid:
                all_grids.append(grid)

        if not all_grids:
            html = "<p>No tables detected.</p>"
            csv_str = ""
        elif len(all_grids) == 1:
            html = _grid_to_html(all_grids[0])
            csv_str = _grid_to_csv(all_grids[0])
        else:
            parts_html, parts_csv = [], []
            for i, grid in enumerate(all_grids, 1):
                parts_html.append(f"<h4>Table {i}</h4>" + _grid_to_html(grid))
                parts_csv.append(f"# Table {i}\n" + _grid_to_csv(grid))
            html = "\n".join(parts_html)
            csv_str = "\n".join(parts_csv)

        elapsed_ms = int((time.monotonic() - t0) * 1000)
        return {
            "html": html,
            "csv": csv_str,
            "table_count": len(all_grids),
            "processing_time_ms": elapsed_ms,
            "detections": [
                {"bbox": d["bbox"], "confidence": round(d["confidence"], 3)}
                for d in detections
            ],
        }


def get_pipeline() -> TableExtractionPipeline:
    if TableExtractionPipeline._instance is None:
        TableExtractionPipeline._instance = TableExtractionPipeline()
    return TableExtractionPipeline._instance
