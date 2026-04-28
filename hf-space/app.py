import asyncio
import hmac
import io
import json
import os
import gradio as gr
import httpx
from fastapi import (
    BackgroundTasks,
    FastAPI,
    File,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    FileResponse,
    JSONResponse,
    RedirectResponse,
    Response,
    StreamingResponse,
)
from pydantic import BaseModel

import api_keys
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


# ---------------------------------------------------------------------------
# API-key gating. Off by default (your own frontend keeps working without a
# key). Turn on by setting REQUIRE_API_KEY=1 as a Space secret. Manage keys
# via /api/admin/keys, protected by ADMIN_API_KEY (also a Space secret).
# ---------------------------------------------------------------------------

def _truthy(v: str | None) -> bool:
    return (v or "").strip().lower() in {"1", "true", "yes", "on"}


def _extract_token(request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    x = request.headers.get("x-api-key", "")
    return x.strip()


def _gated_path(path: str) -> bool:
    """Endpoints that require a consumer API key when gating is on."""
    if path == "/api/extract":
        return True
    if path == "/api/jobs" or path.startswith("/api/jobs/"):
        return True
    return False


@api.middleware("http")
async def api_key_gate(request, call_next):
    if not _truthy(os.environ.get("REQUIRE_API_KEY")):
        return await call_next(request)
    if not _gated_path(request.url.path):
        return await call_next(request)
    if request.method == "OPTIONS":
        return await call_next(request)
    token = _extract_token(request)
    if not token or not api_keys.verify_key(token):
        return JSONResponse(
            {"detail": "Missing or invalid API key."},
            status_code=401,
            headers={"WWW-Authenticate": "Bearer"},
        )
    return await call_next(request)


def _check_admin(request) -> None:
    expected = os.environ.get("ADMIN_API_KEY", "")
    if not expected:
        raise HTTPException(503, "Admin API disabled (set ADMIN_API_KEY secret).")
    auth = request.headers.get("authorization", "")
    x = request.headers.get("x-admin-key", "")
    token = (
        x.strip()
        if x
        else (auth[7:].strip() if auth.lower().startswith("bearer ") else "")
    )
    if not token or not hmac.compare_digest(token, expected):
        raise HTTPException(401, "Invalid admin key.")


class _CreateKeyBody(BaseModel):
    name: str


@api.get("/api/admin/keys")
def admin_list_keys(request: Request):
    _check_admin(request)
    return {"keys": api_keys.list_keys()}


@api.post("/api/admin/keys")
def admin_create_key(body: _CreateKeyBody, request: Request):
    _check_admin(request)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "name is required.")
    return api_keys.create_key(name)


@api.delete("/api/admin/keys/{key_id}")
def admin_revoke_key(key_id: str, request: Request):
    _check_admin(request)
    if not api_keys.revoke_key(key_id):
        raise HTTPException(404, "Key not found.")
    return {"ok": True}

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
    info = jobsvc.get_health()
    info["model"] = "yolov8 + table-transformer + paddleocr"
    return info


@api.get("/api/metrics")
def metrics():
    return jobsvc.get_metrics()


@api.get("/")
def root():
    return RedirectResponse(url="/ui/")


# ---------------------------------------------------------------------------
# Chatbot proxy — forwards to Groq with the user's question + optional
# auto-attached context from a current job. Key lives in $GROQ_API_KEY.
# ---------------------------------------------------------------------------
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
CHAT_MAX_TABLES = 8       # cap on tables stuffed into context
CHAT_MAX_TABLE_CHARS = 4000  # per-table CSV truncation

_CHAT_SYSTEM_PROMPT = (
    "You are an in-app assistant for a table-extraction tool. The user "
    "uploaded an image or PDF; the app detected and extracted tables and "
    "may have attached them as CSV in the next message. Answer questions "
    "about the data, help interpret values, suggest fixes for OCR errors, "
    "and explain how to use the app (upload, detect, confirm, recognize, "
    "edit cells, download CSV/XLSX/HTML). Keep responses concise.\n\n"
    "## Charts\n"
    "When the user asks for a chart, plot, or graph, emit a fenced code "
    "block tagged `chart` containing JSON. The frontend renders it "
    "inline with Recharts. Schema:\n"
    "```chart\n"
    '{\n'
    '  "type": "bar" | "line" | "pie" | "scatter",\n'
    '  "title": "optional title",\n'
    '  "x": "name of x-axis field",\n'
    '  "y": "name of y-axis field" | ["field1", "field2"],\n'
    '  "data": [{"<x>": ..., "<y>": ...}, ...]\n'
    '}\n'
    "```\n"
    "Use real values from the attached tables — never invent numbers. "
    "Briefly describe the chart in prose alongside the block.\n\n"
    "## Cell fixes\n"
    "When you spot a likely OCR error and want to suggest a single-cell "
    "fix, emit a fenced code block tagged `patch` with JSON. The "
    "frontend renders these as Apply / Reject buttons that update the "
    "user's editable table. Schema:\n"
    "```patch\n"
    '{\n'
    '  "table_index": <table number 1..N as shown in attached context>,\n'
    '  "row": <0-based row index>,\n'
    '  "col": <0-based col index>,\n'
    '  "new_value": "corrected text",\n'
    '  "note": "why this is likely a fix"\n'
    '}\n'
    "```\n"
    "Only emit a patch when confident; otherwise mention the concern in "
    "prose without a patch block. Multiple patch blocks per reply are "
    "allowed.\n\n"
    "## Calendar\n"
    "When the table contains dated events (exam timetables, assignment "
    "due dates, schedules, deadlines), emit a fenced `calendar` block "
    "alongside a short prose summary. The frontend renders it as a "
    "month-grid with the events highlighted. Schema:\n"
    "```calendar\n"
    '{\n'
    '  "title": "optional title",\n'
    '  "events": [\n'
    '    {"date": "YYYY-MM-DD", "label": "Math Exam", "time": "09:00", "color": "optional CSS color"}\n'
    '  ]\n'
    '}\n'
    "```\n"
    "Dates MUST be ISO `YYYY-MM-DD`. If the table only gives day/month, "
    "infer a sensible year from context and say so in prose. Skip rows "
    "without a parseable date. Keep `label` short (1–3 words)."
)


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    job_id: str | None = None


def _build_job_context(job_id: str) -> str:
    job = jobsvc.get_job(job_id)
    if job is None or not job.tables:
        return ""
    lines: list[str] = [
        f"# Attached extracted tables (job {job_id})",
        f"# {len(job.tables)} table(s) total; showing up to {CHAT_MAX_TABLES}.",
        "",
    ]
    for i, t in enumerate(job.tables[:CHAT_MAX_TABLES], start=1):
        csv = t.csv or ""
        if len(csv) > CHAT_MAX_TABLE_CHARS:
            csv = csv[:CHAT_MAX_TABLE_CHARS] + "\n# (truncated)"
        lines.append(f"## Table {i} (page {t.page_index + 1})")
        lines.append("```csv")
        lines.append(csv.rstrip())
        lines.append("```")
        lines.append("")
    if len(job.tables) > CHAT_MAX_TABLES:
        lines.append(f"# {len(job.tables) - CHAT_MAX_TABLES} more table(s) omitted.")
    return "\n".join(lines)


@api.post("/api/chat")
async def chat(req: ChatRequest):
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(503, "Chat is not configured: GROQ_API_KEY missing on server.")
    if not req.messages:
        raise HTTPException(400, "messages is empty.")

    messages: list[dict] = [{"role": "system", "content": _CHAT_SYSTEM_PROMPT}]
    if req.job_id:
        ctx = _build_job_context(req.job_id)
        if ctx:
            messages.append({"role": "system", "content": ctx})
    for m in req.messages:
        if m.role not in ("user", "assistant"):
            continue
        messages.append({"role": m.role, "content": m.content})

    payload = {
        "model": GROQ_MODEL,
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": 1024,
        "stream": True,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    async def stream_groq():
        # Forward Groq's SSE stream as plain text deltas separated by NUL.
        # The frontend reads chunks via fetch + ReadableStream and concats.
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream(
                    "POST", GROQ_URL, json=payload, headers=headers
                ) as r:
                    if r.status_code >= 400:
                        body = (await r.aread()).decode("utf-8", "replace")
                        yield f"\x00ERROR\x00Groq {r.status_code}: {body[:300]}".encode()
                        return
                    async for line in r.aiter_lines():
                        if not line or not line.startswith("data: "):
                            continue
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        try:
                            obj = json.loads(data)
                            delta = obj["choices"][0].get("delta", {}).get("content")
                            if delta:
                                yield delta.encode("utf-8")
                        except Exception:
                            continue
        except httpx.HTTPError as e:
            yield f"\x00ERROR\x00Upstream: {e}".encode()

    return StreamingResponse(stream_groq(), media_type="text/plain; charset=utf-8")


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
        async with jobsvc.inference_slot():
            result = await asyncio.to_thread(get_pipeline().extract, data)
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
        # PDF rasterize + cv2 reads are CPU-bound — must not block the loop.
        job = await asyncio.to_thread(jobsvc.create_job, uploads)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Failed to process files: {e}")
    return {"job_id": job.id, "status": job.status, "pages": job.pages}


@api.post("/api/jobs/{job_id}/pages")
async def add_pages(job_id: str, files: list[UploadFile] = File(...)):
    if jobsvc.get_job(job_id) is None:
        raise HTTPException(404, "job not found")
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
        job = await asyncio.to_thread(jobsvc.add_pages_to_job, job_id, uploads)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"job_id": job.id, "status": job.status, "pages": job.pages}


@api.delete("/api/jobs/{job_id}/pages/{page_index}")
def delete_page(job_id: str, page_index: int):
    try:
        job = jobsvc.remove_page(job_id, page_index)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return {"job_id": job.id, "status": job.status, "pages": job.pages}


@api.post("/api/jobs/{job_id}/pages/{page_index}/rotate")
def rotate_page(
    job_id: str,
    page_index: int,
    degrees: float | None = None,
    direction: str | None = None,
):
    """Rotate the page by `degrees` (positive = clockwise). Backwards-
    compatible direction= alias still works: 'left' → -90, 'right' → 90."""
    if degrees is None:
        if direction == "left":
            degrees = -90.0
        elif direction == "right":
            degrees = 90.0
        else:
            raise HTTPException(400, "Provide degrees=<float> or direction=left|right")
    try:
        job = jobsvc.rotate_page(job_id, page_index, float(degrees))
    except ValueError as e:
        raise HTTPException(404, str(e))
    return {"job_id": job.id, "status": job.status, "pages": job.pages}


@api.get("/api/jobs/{job_id}/pages/{page_index}")
def get_page_image(job_id: str, page_index: int):
    path = jobsvc.page_image_path(job_id, page_index)
    if path is None or not path.exists():
        raise HTTPException(404, "page not found")
    return FileResponse(str(path), media_type="image/png")


@api.post("/api/jobs/{job_id}/detect")
async def detect(job_id: str, body: DetectRequest):
    job = jobsvc.get_job(job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    async with jobsvc.inference_slot():
        await asyncio.to_thread(jobsvc.run_detect, job_id, body.pages)
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


async def _run_recognize_task(job_id: str, confirmed: list[dict]) -> None:
    """Take the inference slot, then run the sync pipeline in a thread.
    Multiple recognize jobs queue up; the event loop stays free for status
    polls and page-image fetches throughout."""
    async with jobsvc.inference_slot():
        await asyncio.to_thread(jobsvc.run_recognize, job_id, confirmed)


@api.post("/api/jobs/{job_id}/recognize")
async def recognize(job_id: str, body: RecognizeRequest, background: BackgroundTasks):
    job = jobsvc.get_job(job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    if not body.confirmed:
        raise HTTPException(400, "no confirmed tables")
    confirmed = [c.model_dump() for c in body.confirmed]
    background.add_task(_run_recognize_task, job_id, confirmed)
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


@api.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    ok = jobsvc.request_cancel(job_id)
    if not ok:
        raise HTTPException(404, "job not found")
    return {"cancel_requested": True}


@api.get("/api/jobs/{job_id}/csv")
def download_combined_csv(job_id: str):
    try:
        data = jobsvc.build_combined_csv(job_id)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return Response(
        content=data,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="tables_{job_id}.csv"',
        },
    )


@api.get("/api/jobs/{job_id}/xlsx")
def download_xlsx(job_id: str):
    try:
        data = jobsvc.build_combined_xlsx(job_id)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="tables_{job_id}.xlsx"',
        },
    )


@api.get("/api/jobs/{job_id}/html")
def download_html(job_id: str):
    try:
        data = jobsvc.build_combined_html(job_id)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return Response(
        content=data,
        media_type="text/html; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="tables_{job_id}.html"',
        },
    )


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
