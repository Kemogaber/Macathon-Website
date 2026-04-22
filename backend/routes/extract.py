import time
from fastapi import APIRouter, UploadFile, File, HTTPException
from models.schemas import ExtractionResponse

router = APIRouter()


def _mock_extract(image_bytes: bytes) -> dict:
    """
    PLACEHOLDER — replace this function body with your actual AI pipeline:
      1. Table Detection model
      2. Structure Recognition model
      3. OCR module
    Returns dict with keys: html, csv, table_count
    """
    html = """<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
  <thead>
    <tr>
      <th>Product</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>Widget A</td><td>1,200</td><td>1,450</td><td>1,380</td><td>1,620</td></tr>
    <tr><td>Widget B</td><td>830</td><td>910</td><td>870</td><td>950</td></tr>
    <tr><td>Widget C</td><td>2,100</td><td>2,340</td><td>2,210</td><td>2,480</td></tr>
  </tbody>
</table>"""

    csv = "Product,Q1,Q2,Q3,Q4\nWidget A,1200,1450,1380,1620\nWidget B,830,910,870,950\nWidget C,2100,2340,2210,2480\n"

    return {"html": html, "csv": csv, "table_count": 1}


@router.post("/extract", response_model=ExtractionResponse)
async def extract_table(file: UploadFile = File(...)):
    allowed = {"image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"}
    if file.content_type not in allowed:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {file.content_type}")

    image_bytes = await file.read()
    if len(image_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large. Maximum size is 20 MB.")

    start = time.monotonic()
    result = _mock_extract(image_bytes)
    elapsed_ms = int((time.monotonic() - start) * 1000)

    return ExtractionResponse(
        html=result["html"],
        csv=result["csv"],
        table_count=result["table_count"],
        processing_time_ms=elapsed_ms,
    )
