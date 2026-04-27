"""In-memory job manager for the detect-confirm-recognize flow.

Each job lives in /tmp/tablex_jobs/<id>/ and holds:
  - page_001.png, page_002.png, ...   rasterized input pages
  - table_<n>.png                      perspective-warped table crops (after recognize)
  - table_<n>.csv                      per-table CSV (after recognize)

In-memory `_JOBS` dict tracks status + cached metadata. Garbage-collected on
TTL expiry by `cleanup_expired()` (called opportunistically on each request).
"""
from __future__ import annotations

import io
import os
import shutil
import threading
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
import pypdfium2 as pdfium
from PIL import Image

from pipeline import get_pipeline


JOB_ROOT = Path("/tmp/tablex_jobs")
JOB_TTL_SECONDS = 60 * 60  # 1 hour
PDF_DPI = 200


@dataclass
class TableResult:
    index: int
    page_index: int
    html: str
    csv: str
    cell_count: int


@dataclass
class Job:
    id: str
    created_at: float
    status: str = "detected"        # detected | running | done | error
    progress: float = 0.0
    error: str | None = None
    pages: list[dict] = field(default_factory=list)   # detect output
    tables: list[TableResult] = field(default_factory=list)


_JOBS: dict[str, Job] = {}
_LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _job_dir(job_id: str) -> Path:
    return JOB_ROOT / job_id


def _bbox_to_quad(bbox: list[int]) -> list[list[float]]:
    x1, y1, x2, y2 = bbox
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]


def cleanup_expired() -> None:
    now = time.time()
    expired: list[str] = []
    with _LOCK:
        for jid, job in _JOBS.items():
            if now - job.created_at > JOB_TTL_SECONDS:
                expired.append(jid)
        for jid in expired:
            _JOBS.pop(jid, None)
    for jid in expired:
        shutil.rmtree(_job_dir(jid), ignore_errors=True)


def get_job(job_id: str) -> Job | None:
    return _JOBS.get(job_id)


# ---------------------------------------------------------------------------
# Rasterization
# ---------------------------------------------------------------------------
def _rasterize_pdf(pdf_bytes: bytes, out_dir: Path) -> list[Path]:
    pdf = pdfium.PdfDocument(pdf_bytes)
    scale = PDF_DPI / 72.0
    paths: list[Path] = []
    for i, page in enumerate(pdf, start=1):
        pil = page.render(scale=scale).to_pil().convert("RGB")
        path = out_dir / f"page_{i:03d}.png"
        pil.save(path, format="PNG")
        paths.append(path)
        page.close()
    pdf.close()
    return paths


def _save_image(image_bytes: bytes, out_dir: Path) -> list[Path]:
    pil = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    path = out_dir / "page_001.png"
    pil.save(path, format="PNG")
    return [path]


# ---------------------------------------------------------------------------
# create_job: rasterize + run YOLO detection per page
# ---------------------------------------------------------------------------
def create_job(file_bytes: bytes, content_type: str) -> Job:
    cleanup_expired()
    job_id = uuid.uuid4().hex[:12]
    out_dir = _job_dir(job_id)
    out_dir.mkdir(parents=True, exist_ok=True)

    if content_type == "application/pdf":
        page_paths = _rasterize_pdf(file_bytes, out_dir)
    else:
        page_paths = _save_image(file_bytes, out_dir)

    pages_meta: list[dict] = []
    for i, p in enumerate(page_paths):
        bgr = cv2.imread(str(p))
        h, w = bgr.shape[:2]
        pages_meta.append({
            "index": i,
            "filename": p.name,
            "width": w,
            "height": h,
            "detections": [],
            "detected": False,
        })

    job = Job(id=job_id, created_at=time.time(), pages=pages_meta)
    with _LOCK:
        _JOBS[job_id] = job
    return job


# ---------------------------------------------------------------------------
# detect: run YOLO detection on selected pages (None = all)
# ---------------------------------------------------------------------------
def run_detect(job_id: str, page_indices: list[int] | None) -> None:
    job = _JOBS.get(job_id)
    if job is None:
        return
    pipeline = get_pipeline()
    out_dir = _job_dir(job_id)
    indices = page_indices if page_indices is not None else list(range(len(job.pages)))
    for i in indices:
        if i < 0 or i >= len(job.pages):
            continue
        page = job.pages[i]
        bgr = cv2.imread(str(out_dir / page["filename"]))
        detections = pipeline.detect_boxes(bgr)
        page["detections"] = [
            {"quad": _bbox_to_quad(d["bbox"]), "score": d["score"]}
            for d in detections
        ]
        page["detected"] = True


# ---------------------------------------------------------------------------
# recognize: warp + TSR + OCR per confirmed quad (background task)
# ---------------------------------------------------------------------------
def run_recognize(job_id: str, confirmed: list[dict]) -> None:
    """`confirmed` = [{page_index, quad: [[x,y]×4]}, ...]"""
    job = _JOBS.get(job_id)
    if job is None:
        return
    job.status = "running"
    job.progress = 0.0
    job.error = None
    start_index = len(job.tables)  # append, don't wipe — supports per-page parsing

    pipeline = get_pipeline()
    out_dir = _job_dir(job_id)
    total = max(1, len(confirmed))

    try:
        # Cache page images so we don't re-read for repeated page_index
        page_cache: dict[int, np.ndarray] = {}
        for offset, item in enumerate(confirmed, start=1):
            idx = start_index + offset
            page_index = int(item["page_index"])
            quad = item["quad"]

            if page_index not in page_cache:
                page_cache[page_index] = cv2.imread(
                    str(out_dir / job.pages[page_index]["filename"])
                )
            bgr = page_cache[page_index]

            r = pipeline.recognize_quad(bgr, quad)
            crop_path = out_dir / f"table_{idx}.png"
            csv_path = out_dir / f"table_{idx}.csv"
            cv2.imwrite(str(crop_path), r["crop_bgr"])
            csv_path.write_text(r["csv"], encoding="utf-8")

            job.tables.append(TableResult(
                index=idx,
                page_index=page_index,
                html=r["html"],
                csv=r["csv"],
                cell_count=len(r["cells"]),
            ))
            job.progress = offset / total

        job.status = "done"
        job.progress = 1.0
    except Exception as e:
        job.status = "error"
        job.error = str(e)


# ---------------------------------------------------------------------------
# bundle: return zip bytes
# ---------------------------------------------------------------------------
def build_zip(job_id: str) -> bytes:
    job = _JOBS.get(job_id)
    if job is None or job.status != "done":
        raise ValueError("job not ready")
    out_dir = _job_dir(job_id)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for t in job.tables:
            csv_path = out_dir / f"table_{t.index}.csv"
            png_path = out_dir / f"table_{t.index}.png"
            if csv_path.exists():
                zf.write(csv_path, arcname=f"table_{t.index}.csv")
            if png_path.exists():
                zf.write(png_path, arcname=f"table_{t.index}.png")
    return buf.getvalue()


def build_page_csv_zip(job_id: str, page_index: int) -> bytes:
    job = _JOBS.get(job_id)
    if job is None:
        raise ValueError("job not found")
    out_dir = _job_dir(job_id)
    tables = [t for t in job.tables if t.page_index == page_index]
    if not tables:
        raise ValueError("no tables for page")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for t in tables:
            csv_path = out_dir / f"table_{t.index}.csv"
            if csv_path.exists():
                zf.write(csv_path, arcname=f"table_{t.index}.csv")
    return buf.getvalue()


def page_image_path(job_id: str, page_index: int) -> Path | None:
    job = _JOBS.get(job_id)
    if job is None or page_index < 0 or page_index >= len(job.pages):
        return None
    return _job_dir(job_id) / job.pages[page_index]["filename"]


def table_image_path(job_id: str, table_index: int) -> Path | None:
    if not _JOBS.get(job_id):
        return None
    p = _job_dir(job_id) / f"table_{table_index}.png"
    return p if p.exists() else None
