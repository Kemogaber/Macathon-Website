import io
import gradio as gr
from fastapi import (
    BackgroundTasks,
    FastAPI,
    File,
    HTTPException,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, Response
from pydantic import BaseModel

import jobs as jobsvc
from pipeline import get_pipeline


# ---------------------------------------------------------------------------
# FastAPI app — exposes /api/* routes consumed by the Vercel frontend
# ---------------------------------------------------------------------------
api = FastAPI(title="Macathon Table Extractor (HF Space)")

api.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "image/bmp", "image/tiff",
    "application/pdf",
    "application/zip", "application/x-zip-compressed",
}
MAX_BYTES = 25 * 1024 * 1024
MAX_TOTAL = 100 * 1024 * 1024


# ---------- Schemas ----------
class ExtractionResponse(BaseModel):
    html: str
    csv: str
    table_count: int
    processing_time_ms: int


class ConfirmedQuad(BaseModel):
    page_index: int
    quad: list[list[float]]
    score: float = 0.0


class RecognizeRequest(BaseModel):
    confirmed: list[ConfirmedQuad]


class DetectRequest(BaseModel):
    pages: list[int] | None = None  # None = all pages


# ---------- Health / root ----------
@api.get("/api/health")
def health():
    return {"status": "ok", "model": "yolov8 + table-transformer + paddleocr"}


@api.get("/api/metrics")
def metrics():
    return jobsvc.get_metrics()


@api.get("/")
def root():
    return RedirectResponse(url="/ui/")


# ---------- Legacy one-shot extract (back-compat) ----------
@api.post("/api/extract", response_model=ExtractionResponse)
async def extract(file: UploadFile = File(...)):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(415, f"Unsupported type: {file.content_type}")
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "File too large. Max 20 MB.")
    if file.content_type == "application/pdf":
        raise HTTPException(
            400,
            "PDF input is only supported on /api/jobs (the 3-step flow). "
            "/api/extract takes a single image.",
        )
    try:
        result = get_pipeline().extract(data)
    except Exception as e:
        raise HTTPException(500, str(e))
    return ExtractionResponse(**result)


# ---------- 3-step jobs flow ----------
@api.post("/api/jobs")
async def create_job(files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(400, "No files uploaded.")
    uploads: list[tuple[bytes, str]] = []
    total = 0
    for f in files:
        if f.content_type not in ALLOWED_TYPES:
            raise HTTPException(415, f"Unsupported file type: {f.content_type}")
        data = await f.read()
        if len(data) > MAX_BYTES:
            raise HTTPException(413, f"{f.filename}: file too large (max 25 MB).")
        if not data:
            raise HTTPException(400, f"{f.filename}: empty file.")
        total += len(data)
        if total > MAX_TOTAL:
            raise HTTPException(413, "Combined upload too large (max 100 MB).")
        uploads.append((data, f.content_type))
    try:
        job = jobsvc.create_job(uploads)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Failed to process files: {e}")
    return {"job_id": job.id, "status": job.status, "pages": job.pages}


@api.get("/api/jobs/{job_id}/pages/{page_index}")
def get_page_image(job_id: str, page_index: int):
    path = jobsvc.page_image_path(job_id, page_index)
    if path is None or not path.exists():
        raise HTTPException(404, "page not found")
    return FileResponse(str(path), media_type="image/png")


@api.post("/api/jobs/{job_id}/detect")
def detect(job_id: str, body: DetectRequest):
    job = jobsvc.get_job(job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    jobsvc.run_detect(job_id, body.pages)
    return {
        "pages": [
            {
                "index": p["index"],
                "detections": p.get("detections", []),
                "detected": p.get("detected", False),
            }
            for p in job.pages
        ],
    }


@api.get("/api/jobs/{job_id}/pages/{page_index}/csv-zip")
def page_csv_zip(job_id: str, page_index: int):
    try:
        data = jobsvc.build_page_csv_zip(job_id, page_index)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return Response(
        content=data,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="page_{page_index + 1}_csvs.zip"',
        },
    )


@api.post("/api/jobs/{job_id}/recognize")
def recognize(job_id: str, body: RecognizeRequest, background: BackgroundTasks):
    job = jobsvc.get_job(job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    if not body.confirmed:
        raise HTTPException(400, "no confirmed tables")
    confirmed = [c.model_dump() for c in body.confirmed]
    background.add_task(jobsvc.run_recognize, job_id, confirmed)
    job.status = "running"
    job.progress = 0.0
    return {"status": "running"}


@api.get("/api/jobs/{job_id}/status")
def status(job_id: str):
    job = jobsvc.get_job(job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    return {
        "status": job.status,
        "progress": job.progress,
        "error": job.error,
        "tables": [
            {
                "index": t.index,
                "page_index": t.page_index,
                "html": t.html,
                "csv": t.csv,
                "cell_count": t.cell_count,
                "detection_score": t.detection_score,
                "tsr_confidence": t.tsr_confidence,
                "ocr_confidence": t.ocr_confidence,
                "cells": t.cells,
            }
            for t in job.tables
        ],
    }


@api.get("/api/jobs/{job_id}/tables/{table_index}/image")
def get_table_image(job_id: str, table_index: int):
    path = jobsvc.table_image_path(job_id, table_index)
    if path is None:
        raise HTTPException(404, "table image not found")
    return FileResponse(str(path), media_type="image/png")


@api.get("/api/jobs/{job_id}/download")
def download_zip(job_id: str):
    try:
        data = jobsvc.build_zip(job_id)
    except ValueError:
        raise HTTPException(409, "job not done")
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="tables_{job_id}.zip"'},
    )


# ---------------------------------------------------------------------------
# Gradio UI (kept so HF Space has a browsable demo at /ui)
# ---------------------------------------------------------------------------
def gradio_extract(image):
    if image is None:
        return "<p>Upload an image.</p>", "", "0"
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    result = get_pipeline().extract(buf.getvalue())
    stats = (
        f"Tables found: {result['table_count']} | "
        f"Time: {result['processing_time_ms']} ms"
    )
    return result["html"], result["csv"], stats


with gr.Blocks(title="Table Extractor") as demo:
    gr.Markdown(
        "### Table Extractor\n"
        "Quick one-shot demo. The 3-step flow with corner editing lives in the "
        "Vercel frontend that calls `/api/jobs` on this Space."
    )
    with gr.Row():
        with gr.Column(scale=1):
            img_input = gr.Image(type="pil", label="Input Image", height=320)
            run_btn = gr.Button("Extract", variant="primary", size="sm")
            stats_out = gr.Textbox(label="Stats", lines=2, max_lines=3)
        with gr.Column(scale=2):
            html_out = gr.HTML(label="Extracted Table")
            with gr.Row():
                csv_out = gr.Textbox(label="CSV", lines=6, max_lines=12)
                csv_download = gr.File(label="Download")

    def on_extract(image):
        html, csv_str, stats = gradio_extract(image)
        tmp = None
        if csv_str:
            import tempfile
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".csv", mode="w")
            tmp.write(csv_str)
            tmp.close()
            tmp = tmp.name
        return html, csv_str, stats, tmp

    run_btn.click(
        on_extract,
        inputs=[img_input],
        outputs=[html_out, csv_out, stats_out, csv_download],
    )


# Mount Gradio onto FastAPI so /api/* and /ui/* both work on the Space.
app = gr.mount_gradio_app(api, demo, path="/ui")


if __name__ == "__main__":
    import uvicorn
    demo.queue()
    uvicorn.run(app, host="0.0.0.0", port=7860)
