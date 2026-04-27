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

export interface HealthInfo {
  status: string;
  model?: string;
  uptime_s?: number;
  active_jobs?: number;
  cpu_percent?: number;
  ram_percent?: number;
  ram_used_mb?: number;
  ram_total_mb?: number;
  process_rss_mb?: number;
}

export async function checkHealth(): Promise<HealthInfo> {
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
  status: "detected" | "running" | "done" | "error" | "cancelled";
  progress: number;
  error: string | null;
  tables: TableData[];
}

export interface ConfirmedQuad {
  page_index: number;
  quad: Quad;
  score?: number;
}

export async function createJob(files: File[]): Promise<JobInit> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
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

export function jobCsvUrl(jobId: string): string {
  return `${API_URL}/api/jobs/${jobId}/csv`;
}

export function jobXlsxUrl(jobId: string): string {
  return `${API_URL}/api/jobs/${jobId}/xlsx`;
}

export function jobHtmlUrl(jobId: string): string {
  return `${API_URL}/api/jobs/${jobId}/html`;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function streamChat(
  messages: ChatMessage[],
  jobId: string | undefined,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, job_id: jobId ?? null }),
    signal,
  });
  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail ?? `Request failed (${res.status})`);
  }
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // Server emits "\x00ERROR\x00<message>" once on upstream failure; otherwise
  // pure UTF-8 text deltas.
  let acc = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });
    const errIdx = acc.indexOf("\x00ERROR\x00");
    if (errIdx >= 0) {
      const before = acc.slice(0, errIdx);
      if (before) onDelta(before);
      throw new Error(acc.slice(errIdx + 7));
    }
    onDelta(acc);
    acc = "";
  }
}

export async function cancelJob(jobId: string): Promise<void> {
  await fetch(`${API_URL}/api/jobs/${jobId}/cancel`, { method: "POST" }).catch(
    () => {},
  );
}

export async function addFilesToJob(jobId: string, files: File[]): Promise<JobInit> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  const res = await fetch(`${API_URL}/api/jobs/${jobId}/pages`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export async function removePageFromJob(
  jobId: string,
  pageIndex: number,
): Promise<JobInit> {
  const res = await fetch(`${API_URL}/api/jobs/${jobId}/pages/${pageIndex}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export async function rotatePage(
  jobId: string,
  pageIndex: number,
  direction: "left" | "right",
): Promise<JobInit> {
  const res = await fetch(
    `${API_URL}/api/jobs/${jobId}/pages/${pageIndex}/rotate?direction=${direction}`,
    { method: "POST" },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail ?? `Request failed (${res.status})`);
  }
  return res.json();
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
  // Retry transient 5xx (HF Space sometimes blips during heavy work).
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${API_URL}/api/jobs/${jobId}/status`);
      if (res.ok) return res.json();
      if (res.status >= 500 && attempt < 2) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
      throw new Error(`Status check failed (${res.status})`);
    } catch (e) {
      lastErr = e;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Status check failed");
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
