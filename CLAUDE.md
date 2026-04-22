# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Frontend (Next.js 16 + Tailwind v4)
```bash
cd frontend
npm run dev       # dev server at localhost:3000
npm run build     # production build
npm run lint      # ESLint
```

### Backend (FastAPI)
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Health check: `GET http://localhost:8000/api/health`

## Architecture

```
/
├── frontend/   Next.js 16 App Router (TypeScript + Tailwind v4)
└── backend/    FastAPI (Python)
```

### Frontend structure
- `app/` — App Router pages: `/` (landing), `/demo`, `/how-it-works`, `/about`
- `components/` — Navbar, Footer, UploadZone, ResultTable, DownloadButtons
- `lib/api.ts` — fetch wrapper calling the FastAPI backend
- `.env.local` — `NEXT_PUBLIC_API_URL=http://localhost:8000`

**Tailwind v4**: Configuration is CSS-only in `app/globals.css` via `@theme inline` — there is no `tailwind.config.ts`. Custom design tokens (colors, fonts) live in `globals.css`. Custom utilities (`glass`, `gradient-border`, `glow-cyan`, `gradient-text`, `grid-bg`) are also defined there.

### Backend structure
- `main.py` — FastAPI app, CORS, mounts `/api` router
- `routes/extract.py` — `POST /api/extract` (multipart image → JSON)
- `models/schemas.py` — Pydantic models for request/response

### Plugging in the real AI model
Replace the `_mock_extract()` function body in `backend/routes/extract.py`. The function receives `image_bytes: bytes` and must return `{"html": str, "csv": str, "table_count": int}`. The HTTP interface is already complete.

## Design system
- Background: `#0a0b0f`, surfaces use `glass` utility (glassmorphism)
- Accent: `#00d4ff` (cyan), secondary: `#7c3aed` (purple)
- Gradient text via `.gradient-text`, glow via `.glow-cyan`
- Font: Inter via `next/font/google`
