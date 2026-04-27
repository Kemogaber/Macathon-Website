import asyncio

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

import jobs as jobsvc

router = APIRouter()

ALLOWED_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "image/bmp", "image/tiff",
    "application/pdf",
    "application/zip", "application/x-zip-compressed",
}
MAX_BYTES = 25 * 1024 * 1024  # 25 MB per file
MAX_TOTAL = 100 * 1024 * 1024  # 100 MB combined


class ConfirmedQuad(BaseModel):
    page_index: int
    quad: list[list[float]]   # 4 points × 2 coords


class RecognizeRequest(BaseModel):
    confirmed: list[ConfirmedQuad]


class DetectRequest(BaseModel):
    pages: list[int] | None = None  # None = all pages


@router.post("/jobs")
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

    return {
        "job_id": job.id,
        "status": job.status,
        "pages": job.pages,
    }


@router.post("/jobs/{job_id}/pages")
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


@router.delete("/jobs/{job_id}/pages/{page_index}")
def delete_page(job_id: str, page_index: int):
    try:
        job = jobsvc.remove_page(job_id, page_index)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return {"job_id": job.id, "status": job.status, "pages": job.pages}


@router.get("/jobs/{job_id}/pages/{page_index}")
def get_page_image(job_id: str, page_index: int):
    path = jobsvc.page_image_path(job_id, page_index)
    if path is None or not path.exists():
        raise HTTPException(404, "page not found")
    return FileResponse(str(path), media_type="image/png")


@router.post("/jobs/{job_id}/detect")
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


@router.get("/jobs/{job_id}/pages/{page_index}/csv-zip")
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
    """Background coroutine: take the inference slot, then run the sync
    pipeline in a thread. Multiple users can have recognize jobs queued —
    they execute one at a time but the event loop stays responsive for
    status polls and page-image fetches throughout."""
    async with jobsvc.inference_slot():
        await asyncio.to_thread(jobsvc.run_recognize, job_id, confirmed)


@router.post("/jobs/{job_id}/recognize")
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


@router.get("/jobs/{job_id}/status")
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
            }
            for t in job.tables
        ],
    }


@router.get("/jobs/{job_id}/tables/{table_index}/image")
def get_table_image(job_id: str, table_index: int):
    path = jobsvc.table_image_path(job_id, table_index)
    if path is None:
        raise HTTPException(404, "table image not found")
    return FileResponse(str(path), media_type="image/png")


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    ok = jobsvc.request_cancel(job_id)
    if not ok:
        raise HTTPException(404, "job not found")
    return {"cancel_requested": True}


@router.get("/jobs/{job_id}/csv")
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


@router.get("/jobs/{job_id}/xlsx")
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


@router.get("/jobs/{job_id}/html")
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


@router.get("/jobs/{job_id}/download")
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
