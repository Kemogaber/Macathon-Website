const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

// ---------- legacy one-shot ----------
export interface ExtractionResult {
  html: string;
  csv: string;
  table_count: number;
  processing_time_ms: number;
}

export async function extractTable(file: File): Promise<ExtractionResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}/api/extract`, { method: "POST", body: form });
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

// ---------- 3-step jobs flow ----------
export type Quad = [[number, number], [number, number], [number, number], [number, number]];

export interface Detection {
  quad: Quad;
  score: number;
}

export interface PageMeta {
  index: number;
  filename: string;
  width: number;
  height: number;
  detections: Detection[];
  detected?: boolean;
}

export interface DetectResponse {
  pages: { index: number; detections: Detection[]; detected: boolean }[];
}

export interface JobInit {
  job_id: string;
  status: string;
  pages: PageMeta[];
}

export interface CellData {
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
  text: string;
  tsr_score: number | null;
  ocr_score: number | null;
}

export interface TableData {
  index: number;
  page_index: number;
  html: string;
  csv: string;
  cell_count: number;
  detection_score?: number;
  tsr_confidence?: number;
  ocr_confidence?: number;
  cells?: CellData[];
}

export interface JobStatus {
  status: "detected" | "running" | "done" | "error";
  progress: number;
  error: string | null;
  tables: TableData[];
}

export interface ConfirmedQuad {
  page_index: number;
  quad: Quad;
  score?: number;
}

export async function createJob(file: File): Promise<JobInit> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}/api/jobs`, { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

export function pageImageUrl(jobId: string, pageIndex: number): string {
  return `${API_URL}/api/jobs/${jobId}/pages/${pageIndex}`;
}

export function tableImageUrl(jobId: string, tableIndex: number): string {
  return `${API_URL}/api/jobs/${jobId}/tables/${tableIndex}/image`;
}

export function jobZipUrl(jobId: string): string {
  return `${API_URL}/api/jobs/${jobId}/download`;
}

export function pageCsvZipUrl(jobId: string, pageIndex: number): string {
  return `${API_URL}/api/jobs/${jobId}/pages/${pageIndex}/csv-zip`;
}

export async function detectPages(
  jobId: string,
  pages: number[] | null,
): Promise<DetectResponse> {
  const res = await fetch(`${API_URL}/api/jobs/${jobId}/detect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pages }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

export async function startRecognize(
  jobId: string,
  confirmed: ConfirmedQuad[],
): Promise<void> {
  const res = await fetch(`${API_URL}/api/jobs/${jobId}/recognize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmed }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail ?? `Request failed with status ${res.status}`);
  }
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const res = await fetch(`${API_URL}/api/jobs/${jobId}/status`);
  if (!res.ok) throw new Error(`Status check failed (${res.status})`);
  return res.json();
}

// ---------- metrics ----------
export interface MetricEntry {
  ts: number;
  job_id: string;
  status: "done" | "error";
  duration_ms: number;
  table_count: number;
  error: string | null;
}

export interface MetricsData {
  uptime_s: number;
  jobs_created: number;
  jobs_succeeded: number;
  jobs_failed: number;
  active_jobs: number;
  success_rate: number;
  latency_ms: { p50: number; p95: number; avg: number };
  recent: MetricEntry[];
}

export async function getMetrics(): Promise<MetricsData> {
  const res = await fetch(`${API_URL}/api/metrics`);
  if (!res.ok) throw new Error(`Metrics fetch failed (${res.status})`);
  return res.json();
}
