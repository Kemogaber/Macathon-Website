const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface ExtractionResult {
  html: string;
  csv: string;
  table_count: number;
  processing_time_ms: number;
}

export async function extractTable(file: File): Promise<ExtractionResult> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${API_URL}/api/extract`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail ?? `Request failed with status ${res.status}`);
  }

  return res.json();
}

export async function checkHealth(): Promise<{ status: string; model: string }> {
  const res = await fetch(`${API_URL}/api/health`);
  return res.json();
}
