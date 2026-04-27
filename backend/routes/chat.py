"""Chatbot proxy: forwards to Groq with optional auto-attached job tables.

Reads the API key from $GROQ_API_KEY. Returns 503 if missing.
"""
from __future__ import annotations

import json
import os

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import jobs as jobsvc

router = APIRouter()

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
CHAT_MAX_TABLES = 8
CHAT_MAX_TABLE_CHARS = 4000

_SYSTEM_PROMPT = (
    "You are an in-app assistant for a table-extraction tool. The user "
    "uploaded an image or PDF; the app detected and extracted tables and "
    "may have attached them as CSV in the next message. Answer questions "
    "about the data, help interpret values, suggest fixes for OCR errors, "
    "and explain how to use the app (upload, detect, confirm, recognize, "
    "edit cells, download CSV/XLSX/HTML). Keep responses concise.\n\n"
    "## Charts\n"
    "When the user asks for a chart, plot, or graph, emit a fenced code "
    "block tagged `chart` containing JSON. The frontend renders it "
    "inline with Recharts. Schema:\n"
    "```chart\n"
    '{\n'
    '  "type": "bar" | "line" | "pie" | "scatter",\n'
    '  "title": "optional title",\n'
    '  "x": "name of x-axis field",\n'
    '  "y": "name of y-axis field" | ["field1", "field2"],\n'
    '  "data": [{"<x>": ..., "<y>": ...}, ...]\n'
    '}\n'
    "```\n"
    "Use real values from the attached tables — never invent numbers. "
    "Briefly describe the chart in prose alongside the block.\n\n"
    "## Cell fixes\n"
    "When you spot a likely OCR error and want to suggest a single-cell "
    "fix, emit a fenced code block tagged `patch` with JSON. The "
    "frontend renders these as Apply / Reject buttons that update the "
    "user's editable table. Schema:\n"
    "```patch\n"
    '{\n'
    '  "table_index": <table number 1..N as shown in attached context>,\n'
    '  "row": <0-based row index>,\n'
    '  "col": <0-based col index>,\n'
    '  "new_value": "corrected text",\n'
    '  "note": "why this is likely a fix"\n'
    '}\n'
    "```\n"
    "Only emit a patch when confident; otherwise mention the concern in "
    "prose without a patch block. Multiple patch blocks per reply are "
    "allowed."
)


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    job_id: str | None = None


def _build_job_context(job_id: str) -> str:
    job = jobsvc.get_job(job_id)
    if job is None or not job.tables:
        return ""
    lines: list[str] = [
        f"# Attached extracted tables (job {job_id})",
        f"# {len(job.tables)} table(s) total; showing up to {CHAT_MAX_TABLES}.",
        "",
    ]
    for i, t in enumerate(job.tables[:CHAT_MAX_TABLES], start=1):
        csv = t.csv or ""
        if len(csv) > CHAT_MAX_TABLE_CHARS:
            csv = csv[:CHAT_MAX_TABLE_CHARS] + "\n# (truncated)"
        lines.append(f"## Table {i} (page {t.page_index + 1})")
        lines.append("```csv")
        lines.append(csv.rstrip())
        lines.append("```")
        lines.append("")
    if len(job.tables) > CHAT_MAX_TABLES:
        lines.append(f"# {len(job.tables) - CHAT_MAX_TABLES} more table(s) omitted.")
    return "\n".join(lines)


@router.post("/chat")
async def chat(req: ChatRequest):
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(503, "Chat is not configured: GROQ_API_KEY missing on server.")
    if not req.messages:
        raise HTTPException(400, "messages is empty.")

    messages: list[dict] = [{"role": "system", "content": _SYSTEM_PROMPT}]
    if req.job_id:
        ctx = _build_job_context(req.job_id)
        if ctx:
            messages.append({"role": "system", "content": ctx})
    for m in req.messages:
        if m.role not in ("user", "assistant"):
            continue
        messages.append({"role": m.role, "content": m.content})

    payload = {
        "model": GROQ_MODEL,
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": 1024,
        "stream": True,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    async def stream_groq():
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream(
                    "POST", GROQ_URL, json=payload, headers=headers
                ) as r:
                    if r.status_code >= 400:
                        body = (await r.aread()).decode("utf-8", "replace")
                        yield f"\x00ERROR\x00Groq {r.status_code}: {body[:300]}".encode()
                        return
                    async for line in r.aiter_lines():
                        if not line or not line.startswith("data: "):
                            continue
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        try:
                            obj = json.loads(data)
                            delta = obj["choices"][0].get("delta", {}).get("content")
                            if delta:
                                yield delta.encode("utf-8")
                        except Exception:
                            continue
        except httpx.HTTPError as e:
            yield f"\x00ERROR\x00Upstream: {e}".encode()

    return StreamingResponse(stream_groq(), media_type="text/plain; charset=utf-8")
