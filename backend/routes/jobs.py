from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

import jobs as jobsvc

router = APIRouter()

ALLOWED_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf",
}
MAX_BYTES = 25 * 1024 * 1024  # 25 MB


class ConfirmedQuad(BaseModel):
    page_index: int
    quad: list[list[float]]   # 4 points × 2 coords


class RecognizeRequest(BaseModel):
    confirmed: list[ConfirmedQuad]


class DetectRequest(BaseModel):
    pages: list[int] | None = None  # None = all pages


@router.post("/jobs")
async def create_job(file: UploadFile = File(...)):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(415, f"Unsupported file type: {file.content_type}")
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File too large. Max 25 MB.")
    if not data:
        raise HTTPException(400, "Empty file.")

    try:
        job = jobsvc.create_job(data, file.content_type)
    except Exception as e:
        raise HTTPException(500, f"Failed to process file: {e}")

    return {
        "job_id": job.id,
        "status": job.status,
        "pages": job.pages,
    }


@router.get("/jobs/{job_id}/pages/{page_index}")
def get_page_image(job_id: str, page_index: int):
    path = jobsvc.page_image_path(job_id, page_index)
    if path is None or not path.exists():
        raise HTTPException(404, "page not found")
    return FileResponse(str(path), media_type="image/png")


@router.post("/jobs/{job_id}/detect")
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


@router.post("/jobs/{job_id}/recognize")
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
