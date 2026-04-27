import io
import time
import gradio as gr
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from pipeline import get_pipeline

# ---------------------------------------------------------------------------
# FastAPI app (exposes /api/extract + /api/health for the Next.js frontend)
# ---------------------------------------------------------------------------
api = FastAPI()

api.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ExtractionResponse(BaseModel):
    html: str
    csv: str
    table_count: int
    processing_time_ms: int
    # Structured per-table data:
    # [{table_id, bbox, cells: [{bbox, row, col, rowspan, colspan, text}]}]
    tables: list = []


@api.get("/api/health")
def health():
    return {"status": "ok", "model": "yolov8+table-transformer+paddleocr"}


@api.get("/")
def root():
    return RedirectResponse(url="/ui/")


@api.post("/api/extract", response_model=ExtractionResponse)
async def extract(file: UploadFile = File(...)):
    allowed = {"image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"}
    if file.content_type not in allowed:
        raise HTTPException(status_code=415, detail=f"Unsupported type: {file.content_type}")

    image_bytes = await file.read()
    if len(image_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large. Max 20 MB.")

    try:
        result = _run_pipeline(image_bytes)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return ExtractionResponse(
        html=result["html"],
        csv=result["csv"],
        table_count=result["table_count"],
        processing_time_ms=result["processing_time_ms"],
        tables=result.get("tables", []),
    )


def _run_pipeline(image_bytes: bytes) -> dict:
    pipeline = get_pipeline()
    return pipeline.extract(image_bytes)


# ---------------------------------------------------------------------------
# Gradio UI (demo interface + required for HF Spaces to serve the app)
# ---------------------------------------------------------------------------
def gradio_extract(image):
    if image is None:
        return "<p>Upload an image.</p>", "", "0", {}

    buf = io.BytesIO()
    image.save(buf, format="PNG")
    result = get_pipeline().extract(buf.getvalue())

    confidence_info = ""
    if result.get("detections"):
        confidence_info = "\n".join(
            f"Table {i+1}: {d['confidence']*100:.1f}%"
            for i, d in enumerate(result["detections"])
        )

    stats = (
        f"Tables found: {result['table_count']} | "
        f"Time: {result['processing_time_ms']} ms\n"
        f"{confidence_info}"
    )
    return result["html"], result["csv"], stats, result.get("tables", [])


with gr.Blocks(title="Table Extractor") as demo:
    gr.Markdown("### Table Extractor\nUpload an image of a table to extract its contents.")

    with gr.Row():
        with gr.Column(scale=1):
            img_input = gr.Image(type="pil", label="Input Image", height=320)
            run_btn = gr.Button("Extract", variant="primary", size="sm")
            stats_out = gr.Textbox(label="Stats", lines=3, max_lines=4)
        with gr.Column(scale=2):
            html_out = gr.HTML(label="Extracted Table", elem_id="table-html")
            with gr.Row():
                csv_out = gr.Textbox(label="CSV", lines=6, max_lines=12)
                csv_download = gr.File(label="Download")
            json_out = gr.JSON(label="Structured tables (cells, row/col, rowspan/colspan, text)")

    def on_extract(image):
        html, csv_str, stats, tables = gradio_extract(image)
        tmp = None
        if csv_str:
            import tempfile, os
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".csv", mode="w")
            tmp.write(csv_str)
            tmp.close()
            tmp = tmp.name
        return html, csv_str, stats, tmp, tables

    run_btn.click(
        on_extract,
        inputs=[img_input],
        outputs=[html_out, csv_out, stats_out, csv_download, json_out],
    )


# ---------------------------------------------------------------------------
# Mount Gradio onto FastAPI so both the UI and /api/* routes are served
# ---------------------------------------------------------------------------
app = gr.mount_gradio_app(api, demo, path="/ui")


if __name__ == "__main__":
    import uvicorn
    demo.queue()
    uvicorn.run(app, host="0.0.0.0", port=7860)
