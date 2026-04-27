# Macathon Table Extractor

Upload an image of a table — get back clean, editable HTML and CSV.

The app detects tables in your image, recognises their structure, runs OCR on the cells, and lets you review and edit the result before exporting.

---

## Quick start

You need two terminals running side by side: one for the backend, one for the frontend.

### 1. Start the backend (FastAPI)

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API is now live at `http://localhost:8000`. Check it with:

```bash
curl http://localhost:8000/api/health
```

### 2. Start the frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000** in your browser.

That's it — drag a table image onto the upload zone and you're off.

---

## How to use it

1. **Upload** — drop an image (PNG / JPG) onto the home page or browse to select one.
2. **Wait a few seconds** while the model detects tables and reads the cells.
3. **Review** the detected table. You can:
   - Edit any cell inline
   - Adjust bounding boxes if the model missed a row or column
   - Zoom in to check OCR confidence (low-confidence cells are flagged)
4. **Download** as HTML or CSV.

---

## Project layout

```
.
├── frontend/   Next.js 16 app — UI, upload flow, table editor
├── backend/    FastAPI service — detection, structure, OCR
├── hf-space/   Hugging Face Space deployment artifacts
└── notebook/   Research notebooks for the detection model
```

The frontend talks to the backend through `frontend/lib/api.ts`. The base URL is set in `frontend/.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## What's running under the hood

| Stage | Tool |
|---|---|
| Table detection | `macathon-table-detector` (custom) |
| Structure recognition | TATR (Table Transformer) |
| Cell OCR | PaddleOCR |
| API | FastAPI |
| UI | Next.js 16 (App Router) + Tailwind v4 |

Swapping the model: replace the body of `_mock_extract()` in `backend/routes/extract.py`. It receives `image_bytes: bytes` and must return `{"html": str, "csv": str, "table_count": int}`.

---

## Common commands

```bash
# Frontend
cd frontend
npm run dev      # local dev server
npm run build    # production build
npm run lint     # lint check

# Backend
cd backend
uvicorn main:app --reload --port 8000
```

---

## Troubleshooting

**Frontend can't reach the backend.** Confirm the backend is running on port 8000 and that `NEXT_PUBLIC_API_URL` in `frontend/.env.local` matches.

**`pip install` fails on PaddleOCR.** PaddleOCR has heavy native dependencies — make sure you're on Python 3.10+ and have `pip` updated. On Linux you may need `libgl1` and `libglib2.0-0`.

**Upload returns 0 tables.** Try a clearer or higher-resolution crop. The detector works best on tables that fill most of the frame.
