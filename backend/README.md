# Backend — Macathon Table Extractor API

FastAPI service that detects tables in images / PDFs, recognises their structure, runs OCR, and returns HTML + CSV.

## Run it locally

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Health check:

```bash
curl http://localhost:8000/api/health
```

## Layout

```
main.py           FastAPI app, CORS, router mounting
pipeline.py       Detection → structure → OCR pipeline
jobs.py           Job lifecycle + on-disk storage
routes/
  extract.py      Single-shot extraction (image → HTML/CSV)
  jobs.py         Multi-step job API (upload, detect, recognize, download)
models/
  schemas.py      Pydantic request/response models
Dockerfile        Container build
```

## API

### Health

`GET /api/health` → `{ "status": "ok", "model": "..." }`

### Single-shot extract

`POST /api/extract` (multipart, field `file`) → `{ "html": str, "csv": str, "table_count": int }`

Use this when you want one-call extraction with no review step.

### Job flow (used by the web UI)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/jobs` | Upload one or more files, get `job_id` |
| `GET` | `/api/jobs/{id}/pages/{n}` | Fetch a rendered page image |
| `POST` | `/api/jobs/{id}/detect` | Run table detection on selected pages |
| `POST` | `/api/jobs/{id}/recognize` | Run structure + OCR on user-confirmed quads |
| `GET` | `/api/jobs/{id}/status` | Poll progress + collect tables |
| `GET` | `/api/jobs/{id}/tables/{i}/image` | Cropped table image |
| `GET` | `/api/jobs/{id}/pages/{n}/csv-zip` | CSVs for one page, zipped |
| `GET` | `/api/jobs/{id}/csv` | Combined CSV across all tables |
| `GET` | `/api/jobs/{id}/download` | Full zip (HTML + CSVs + images) |
| `POST` | `/api/jobs/{id}/cancel` | Request cancellation |

### Limits

- Max 25 MB per file
- Max 100 MB combined upload
- Accepted types: PNG, JPG, WEBP, GIF, BMP, TIFF, PDF, ZIP

## Pipeline

1. **Detection** — `macathon-table-detector` (Ultralytics YOLO) finds table regions.
2. **Structure recognition** — Microsoft TATR (Table Transformer) maps rows/columns/cells.
3. **OCR** — PaddleOCR reads each cell.
4. **Assembly** — cells are stitched into HTML and CSV.

To swap the model, replace the body of `_mock_extract()` in `routes/extract.py`. It receives `image_bytes: bytes` and must return `{"html": str, "csv": str, "table_count": int}`. The HTTP contract stays the same.

## Dependencies

- `fastapi`, `uvicorn`, `python-multipart`, `pydantic`
- `numpy`, `opencv-python-headless`, `Pillow`, `pypdfium2`
- `torch`, `torchvision`, `transformers`, `huggingface_hub`, `ultralytics`
- `paddlepaddle`, `paddleocr`

Python 3.10+ recommended. On Linux you may need system libs `libgl1` and `libglib2.0-0` for OpenCV / PaddleOCR.

## Docker

```bash
docker build -t macathon-backend .
docker run -p 8000:8000 macathon-backend
```

## Troubleshooting

**PaddleOCR install fails.** Update `pip` and ensure Python ≥ 3.10. On minimal Linux images, install `libgl1 libglib2.0-0` first.

**First request is slow.** Models download from Hugging Face on first use and are cached locally — subsequent requests are fast.

**0 tables detected.** Detection works best on clear, high-res images where the table fills most of the frame. Try the job flow and adjust the quad manually in the UI.
