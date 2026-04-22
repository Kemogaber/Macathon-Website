from pydantic import BaseModel


class ExtractionResponse(BaseModel):
    html: str
    csv: str
    table_count: int
    processing_time_ms: int


class HealthResponse(BaseModel):
    status: str
    model: str
