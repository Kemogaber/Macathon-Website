from fastapi import APIRouter, File, HTTPException, UploadFile

from models.schemas import ExtractionResponse
from pipeline import get_pipeline

router = APIRouter()

ALLOWED_TYPES = {
    "image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf",
}


@router.post("/extract", response_model=ExtractionResponse)
async def extract_table(file: UploadFile = File(...)):
    """One-shot extract — kept for back-compat. The 3-step flow lives in /api/jobs."""
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(415, f"Unsupported file type: {file.content_type}")
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "File too large. Max 20 MB.")

    if file.content_type == "application/pdf":
        raise HTTPException(
            400,
            "PDF input is only supported on /api/jobs (the 3-step flow). "
            "/api/extract takes a single image.",
        )

    result = get_pipeline().extract(data)
    return ExtractionResponse(**result)
