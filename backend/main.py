from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.extract import router as extract_router
from routes.jobs import router as jobs_router
from models.schemas import HealthResponse

app = FastAPI(title="Macathon Table Extractor API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(extract_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")


@app.get("/api/health", response_model=HealthResponse)
def health():
    return HealthResponse(status="ok", model="macathon-table-detector + TATR + PaddleOCR")
