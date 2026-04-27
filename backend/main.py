from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import jobs as jobsvc
from routes.chat import router as chat_router
from routes.extract import router as extract_router
from routes.jobs import router as jobs_router
from routes.keys import router as keys_router

app = FastAPI(title="Macathon Table Extractor API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(extract_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")
app.include_router(chat_router, prefix="/api")
app.include_router(keys_router, prefix="/api")


@app.get("/api/health")
def health():
    info = jobsvc.get_health()
    info["model"] = "macathon-table-detector + TATR + PaddleOCR"
    return info
