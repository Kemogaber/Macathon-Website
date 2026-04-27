# Frontend — Macathon Table Extractor

Next.js 16 (App Router) UI for the table extractor. Users drop in an image or PDF, confirm the detected table regions, and get back editable HTML / CSV.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

The app expects the backend at `http://localhost:8000`. Override with `frontend/.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |

## Layout

```
app/
  page.tsx          Landing page
  demo/             Upload, detect, edit, download flow
  dashboard/        Job dashboard
  how-it-works/     Explainer page
  about/            About page
  layout.tsx        Root layout, fonts, theme
  globals.css       Tailwind v4 theme + custom utilities

components/         UploadZone, EditableTable, QuadEditor, …
lib/
  api.ts            Backend fetch wrappers
  demoStore.tsx     Client-side demo state
  toast.tsx         Toast notifications
```

## Styling

Tailwind v4 — config is **CSS-only** in `app/globals.css` via `@theme inline`. There is no `tailwind.config.ts`. Custom utilities defined there: `glass`, `gradient-border`, `glow-cyan`, `gradient-text`, `grid-bg`.

Design tokens:

- Background `#0a0b0f`
- Accent (cyan) `#00d4ff`
- Secondary (purple) `#7c3aed`
- Font: Inter via `next/font/google`

## Talking to the backend

All HTTP calls go through `lib/api.ts`. The flow:

1. `POST /api/jobs` — upload files, get a `job_id`
2. `POST /api/jobs/{id}/detect` — run table detection
3. User reviews / edits quads in `QuadEditor`
4. `POST /api/jobs/{id}/recognize` — run structure + OCR
5. Poll `GET /api/jobs/{id}/status` until `done`
6. Download via `GET /api/jobs/{id}/download` (zip) or `GET /api/jobs/{id}/csv`

## Deploying

Set `NEXT_PUBLIC_API_URL` to your backend URL in the Vercel project settings, then deploy as normal. `vercel.json` is checked in.

## Heads-up: Next.js version

This is **Next.js 16**. Some APIs and conventions differ from older training data — when in doubt, check `node_modules/next/dist/docs/` before reaching for a pattern from memory.
