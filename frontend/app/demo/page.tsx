"use client";

import { useEffect, useRef, useState } from "react";
import UploadZone from "@/components/UploadZone";
import QuadEditor, {
  quadToRect,
  rectToQuad,
  type RectQuad,
} from "@/components/QuadEditor";
import ImageResults from "@/components/ImageResults";
import {
  createJob,
  detectPages,
  getJobStatus,
  jobZipUrl,
  pageImageUrl,
  startRecognize,
  type ConfirmedQuad,
  type JobInit,
  type JobStatus,
  type TableData,
} from "@/lib/api";

type Step = "upload" | "review" | "error";

interface PerPageState {
  rects: RectQuad[];
  activeRect: number;
  detected: boolean;
  recognized: boolean; // page has been confirmed (TSR+OCR done)
}

export default function DemoPage() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const [job, setJob] = useState<JobInit | null>(null);
  const [pageStates, setPageStates] = useState<PerPageState[]>([]);
  const [currentPage, setCurrentPage] = useState(0);

  const [busy, setBusy] = useState<null | "upload" | "detect-one" | "detect-all" | "confirm-one" | "confirm-all">(null);
  const [confirmProgress, setConfirmProgress] = useState(0);
  const [tables, setTables] = useState<TableData[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------- step 1 → 2 : upload only (no auto-detect) ----------
  async function handleUpload() {
    if (!file) return;
    setErrorMsg("");
    setBusy("upload");
    try {
      const j = await createJob(file);
      setJob(j);
      setPageStates(
        j.pages.map(() => ({
          rects: [],
          activeRect: 0,
          detected: false,
          recognized: false,
        })),
      );
      setCurrentPage(0);
      setTables([]);
      setStep("review");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Upload failed.");
      setStep("error");
    } finally {
      setBusy(null);
    }
  }

  // ---------- detection ----------
  async function runDetection(scope: "one" | "all") {
    if (!job) return;
    setErrorMsg("");
    setBusy(scope === "one" ? "detect-one" : "detect-all");
    try {
      const target = scope === "one" ? [currentPage] : null;
      const res = await detectPages(job.job_id, target);
      setPageStates((prev) => {
        const next = prev.map((p) => ({ ...p }));
        for (const rp of res.pages) {
          if (!rp.detected) continue;
          if (next[rp.index].recognized) continue; // don't overwrite confirmed pages
          next[rp.index].detected = true;
          next[rp.index].rects = rp.detections.map((d) => quadToRect(d.quad));
          next[rp.index].activeRect = 0;
        }
        return next;
      });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Detection failed.");
    } finally {
      setBusy(null);
    }
  }

  // ---------- box editing ----------
  function setRect(pageIdx: number, ri: number, rect: RectQuad) {
    setPageStates((prev) => {
      const next = [...prev];
      const p = { ...next[pageIdx] };
      p.rects = [...p.rects];
      p.rects[ri] = rect;
      next[pageIdx] = p;
      return next;
    });
  }

  function setActiveRect(pageIdx: number, ri: number) {
    setPageStates((prev) => {
      const next = [...prev];
      next[pageIdx] = { ...next[pageIdx], activeRect: ri };
      return next;
    });
  }

  function removeRect(pageIdx: number, ri: number) {
    setPageStates((prev) => {
      const next = [...prev];
      const p = { ...next[pageIdx] };
      p.rects = p.rects.filter((_, i) => i !== ri);
      p.activeRect = Math.max(0, Math.min(p.activeRect, p.rects.length - 1));
      next[pageIdx] = p;
      return next;
    });
  }

  function addRect(pageIdx: number) {
    if (!job) return;
    const page = job.pages[pageIdx];
    const margin = Math.min(page.width, page.height) * 0.15;
    const newRect: RectQuad = {
      cx: page.width / 2,
      cy: page.height / 2,
      w: page.width - margin * 2,
      h: page.height - margin * 2,
      rot: 0,
    };
    setPageStates((prev) => {
      const next = [...prev];
      const p = { ...next[pageIdx] };
      p.rects = [...p.rects, newRect];
      p.activeRect = p.rects.length - 1;
      next[pageIdx] = p;
      return next;
    });
  }

  // ---------- confirmation (recognize) ----------
  function buildConfirmedFrom(pages: number[]): ConfirmedQuad[] {
    const out: ConfirmedQuad[] = [];
    for (const idx of pages) {
      const ps = pageStates[idx];
      if (!ps || ps.recognized || ps.rects.length === 0) continue;
      for (const r of ps.rects) {
        out.push({ page_index: idx, quad: rectToQuad(r), score: 0 });
      }
    }
    return out;
  }

  async function runConfirm(scope: "one" | "all") {
    if (!job || busy) return;
    const targetPages =
      scope === "one"
        ? [currentPage]
        : pageStates
            .map((p, i) => ({ p, i }))
            .filter(({ p }) => p.detected && !p.recognized && p.rects.length > 0)
            .map(({ i }) => i);

    if (scope === "one") {
      const ps = pageStates[currentPage];
      if (!ps || ps.recognized || !ps.detected || ps.rects.length === 0) return;
    }

    const confirmed = buildConfirmedFrom(targetPages);
    if (confirmed.length === 0) {
      setErrorMsg(
        scope === "all"
          ? "No parsed pages with boxes to confirm. Click Parse first."
          : "Nothing to confirm on this page.",
      );
      return;
    }

    setBusy(scope === "one" ? "confirm-one" : "confirm-all");
    setConfirmProgress(0);
    setErrorMsg("");
    try {
      await startRecognize(job.job_id, confirmed);
      pollRef.current = setInterval(async () => {
        try {
          const s: JobStatus = await getJobStatus(job.job_id);
          setConfirmProgress(s.progress);
          setTables(s.tables);
          if (s.status === "done") {
            if (pollRef.current) clearInterval(pollRef.current);
            setPageStates((prev) => {
              const next = prev.map((p) => ({ ...p }));
              for (const i of targetPages) next[i].recognized = true;
              return next;
            });
            setBusy(null);
          } else if (s.status === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
            setErrorMsg(s.error ?? "Recognition failed.");
            setBusy(null);
          }
        } catch (e) {
          if (pollRef.current) clearInterval(pollRef.current);
          setErrorMsg(e instanceof Error ? e.message : "Polling failed.");
          setBusy(null);
        }
      }, 800);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to start parsing.");
      setBusy(null);
    }
  }

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  function reset() {
    setStep("upload");
    setFile(null);
    setJob(null);
    setPageStates([]);
    setCurrentPage(0);
    setTables([]);
    setBusy(null);
    setConfirmProgress(0);
    setErrorMsg("");
  }

  // ---------- render ----------
  const ps = pageStates[currentPage];
  const detectedCount = pageStates.filter((p) => p.detected).length;
  const recognizedCount = pageStates.filter((p) => p.recognized).length;
  const confirmableCount = pageStates.filter(
    (p) => p.detected && !p.recognized && p.rects.length > 0,
  ).length;

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="text-center mb-10">
        <span className="inline-block px-3 py-1 rounded-full border border-[#00d4ff]/20 bg-[rgba(0,212,255,0.1)] text-[#00d4ff] text-xs font-mono mb-4">
          Live Demo
        </span>
        <h1 className="text-4xl font-black text-white mb-3">Table Extractor</h1>
        <Stepper step={step} hasResults={tables.length > 0} />
      </div>

      {step === "upload" && (
        <div className="glass rounded-2xl p-7 gradient-border max-w-3xl mx-auto">
          <UploadZone onFileSelect={setFile} />
          {file && (
            <div className="mt-5 flex items-center justify-between gap-4 flex-wrap">
              <p className="text-sm text-[#9ca3af] font-mono truncate max-w-xs">
                {file.name} · {(file.size / 1024).toFixed(1)} KB
              </p>
              <button
                onClick={handleUpload}
                disabled={busy !== null}
                className="px-6 py-2.5 rounded-xl bg-[#00d4ff] text-[#0a0b0f] font-bold text-sm hover:bg-cyan-300 transition-colors glow-cyan disabled:opacity-50"
              >
                {busy === "upload" ? "Uploading…" : "Upload →"}
              </button>
            </div>
          )}
        </div>
      )}

      {step === "review" && job && ps && (
        <div className="space-y-5">
          {/* page nav + global actions */}
          <div className="glass rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCurrentPage((i) => Math.max(0, i - 1))}
                disabled={currentPage === 0}
                className="px-3 py-1.5 rounded-lg border border-white/10 hover:border-[#00d4ff]/40 disabled:opacity-30 text-sm"
              >
                ← Prev
              </button>
              <span className="font-mono text-sm text-[#9ca3af]">
                Image {currentPage + 1} / {job.pages.length}
              </span>
              <button
                onClick={() =>
                  setCurrentPage((i) => Math.min(job.pages.length - 1, i + 1))
                }
                disabled={currentPage === job.pages.length - 1}
                className="px-3 py-1.5 rounded-lg border border-white/10 hover:border-[#00d4ff]/40 disabled:opacity-30 text-sm"
              >
                Next →
              </button>
              <PageStatusBadge state={ps} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-[#6b7280] font-mono">
                {detectedCount} parsed · {recognizedCount} confirmed
              </span>
            </div>
          </div>

          {/* parse buttons */}
          <div className="glass rounded-2xl p-4 flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-wider text-[#6b7280] mr-2">
              Step 1 — Detect tables
            </span>
            <button
              onClick={() => runDetection("one")}
              disabled={busy !== null || ps.recognized}
              className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:border-[#00d4ff]/40 text-sm disabled:opacity-40"
            >
              {busy === "detect-one" ? "Parsing…" : "Parse this image"}
            </button>
            <button
              onClick={() => runDetection("all")}
              disabled={busy !== null}
              className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:border-[#00d4ff]/40 text-sm disabled:opacity-40"
            >
              {busy === "detect-all" ? "Parsing all…" : "Parse all"}
            </button>
            {ps.detected && !ps.recognized && (
              <span className="text-xs text-[#9ca3af] font-mono ml-2">
                {ps.rects.length} box{ps.rects.length === 1 ? "" : "es"} on this image — adjust below.
              </span>
            )}
          </div>

          {/* editor */}
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <p className="text-xs uppercase tracking-wider text-[#6b7280]">
                {ps.recognized
                  ? "✓ Confirmed — locked. Use arrows to navigate."
                  : ps.detected
                    ? `Drag edges/rotate to fit. ${ps.rects.length} box(es).`
                    : "Not parsed yet — click “Parse this image” to detect tables."}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => addRect(currentPage)}
                  disabled={ps.recognized}
                  className="px-3 py-1 rounded-lg border border-white/10 hover:border-[#00d4ff]/40 text-xs disabled:opacity-40"
                >
                  + Add box
                </button>
              </div>
            </div>

            {ps.detected && (
              <div className="flex flex-wrap gap-2 mb-4">
                {ps.rects.map((_, ri) => (
                  <span
                    key={ri}
                    className={`inline-flex items-center gap-1 rounded-lg text-xs font-mono border transition-colors ${
                      ri === ps.activeRect
                        ? "border-[#00d4ff] bg-[rgba(0,212,255,0.12)] text-[#00d4ff]"
                        : "border-white/10 text-[#9ca3af]"
                    }`}
                  >
                    <button
                      onClick={() => setActiveRect(currentPage, ri)}
                      className="px-3 py-1"
                    >
                      Box {ri + 1}
                    </button>
                    {!ps.recognized && (
                      <button
                        onClick={() => removeRect(currentPage, ri)}
                        title="Remove this region"
                        className="w-5 h-5 mr-1 rounded-md flex items-center justify-center text-red-400 hover:bg-red-500/20 hover:text-red-300"
                      >
                        ✕
                      </button>
                    )}
                  </span>
                ))}
                {ps.rects.length === 0 && (
                  <span className="text-xs text-[#6b7280] font-mono">
                    No tables detected on this image. Use “+ Add box” if you want to draw one.
                  </span>
                )}
              </div>
            )}

            <QuadEditor
              imageUrl={pageImageUrl(job.job_id, currentPage)}
              imageWidth={job.pages[currentPage].width}
              imageHeight={job.pages[currentPage].height}
              rects={ps.rects}
              activeIndex={ps.activeRect}
              onRectChange={(ri, r) => setRect(currentPage, ri, r)}
              onRemove={(ri) => removeRect(currentPage, ri)}
              locked={ps.recognized}
            />
          </div>

          {/* confirm buttons */}
          <div className="glass rounded-2xl p-4 flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-wider text-[#6b7280] mr-2">
              Step 2 — Confirm (run TSR + OCR)
            </span>
            <button
              onClick={() => runConfirm("one")}
              disabled={
                busy !== null ||
                !ps.detected ||
                ps.recognized ||
                ps.rects.length === 0
              }
              className="px-4 py-2 rounded-lg bg-[#00d4ff] text-[#0a0b0f] font-bold text-sm hover:bg-cyan-300 transition-colors glow-cyan disabled:opacity-40"
            >
              {busy === "confirm-one" ? "Confirming…" : "Confirm this image"}
            </button>
            <button
              onClick={() => runConfirm("all")}
              disabled={busy !== null || confirmableCount === 0}
              className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:border-[#00d4ff]/40 text-sm disabled:opacity-40"
            >
              {busy === "confirm-all"
                ? "Confirming all…"
                : `Confirm all (${confirmableCount})`}
            </button>
            {(busy === "confirm-one" || busy === "confirm-all") && (
              <span className="text-xs font-mono text-[#00d4ff] ml-2">
                {Math.round(confirmProgress * 100)}%
              </span>
            )}
            <span className="ml-auto text-xs text-[#6b7280] font-mono">
              Already-confirmed pages are skipped.
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <button
              onClick={reset}
              className="text-xs text-[#6b7280] hover:text-white"
            >
              ← Start over
            </button>
            {tables.length > 0 && (
              <a
                href={jobZipUrl(job.job_id)}
                className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:border-[#00d4ff]/40 text-sm"
              >
                Download all (ZIP)
              </a>
            )}
          </div>

          {errorMsg && <p className="text-red-400 text-sm">{errorMsg}</p>}

          {tables.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-bold text-white">
                Results
                <span className="ml-2 text-xs font-mono text-[#6b7280]">
                  {tables.length} table{tables.length === 1 ? "" : "s"} across{" "}
                  {recognizedCount} image{recognizedCount === 1 ? "" : "s"}
                </span>
              </h2>
              <ImageResults jobId={job.job_id} tables={tables} />
            </div>
          )}
        </div>
      )}

      {step === "error" && (
        <div className="glass rounded-2xl p-6 border border-red-500/20 bg-red-500/5 max-w-xl mx-auto">
          <p className="text-red-400 font-medium">⚠ Something went wrong</p>
          <p className="text-[#9ca3af] text-sm mt-1">{errorMsg}</p>
          <button
            onClick={reset}
            className="mt-4 px-4 py-2 rounded-lg border border-white/10 hover:border-[#00d4ff]/40 text-sm"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function PageStatusBadge({ state }: { state: PerPageState }) {
  if (state.recognized) {
    return (
      <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-mono">
        ✓ Confirmed
      </span>
    );
  }
  if (state.detected) {
    return (
      <span className="px-2 py-0.5 rounded-full bg-[rgba(0,212,255,0.12)] text-[#00d4ff] border border-[#00d4ff]/30 text-xs font-mono">
        ● Parsed
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full bg-white/5 text-[#9ca3af] border border-white/10 text-xs font-mono">
      ○ Not parsed
    </span>
  );
}

function Stepper({ step, hasResults }: { step: Step; hasResults: boolean }) {
  const labels = [
    { id: "upload", label: "Upload" },
    { id: "review", label: "Parse & Confirm" },
    { id: "results", label: "Results" },
  ];
  const active = step === "upload" ? 0 : hasResults ? 2 : 1;
  return (
    <div className="flex items-center justify-center gap-3 mt-3 text-xs font-mono">
      {labels.map((l, i) => (
        <div key={l.id} className="flex items-center gap-3">
          <span
            className={`px-3 py-1 rounded-full border ${
              i <= active
                ? "border-[#00d4ff]/40 bg-[rgba(0,212,255,0.12)] text-[#00d4ff]"
                : "border-white/10 text-[#6b7280]"
            }`}
          >
            {i + 1}. {l.label}
          </span>
          {i < labels.length - 1 && <span className="text-[#6b7280]">—</span>}
        </div>
      ))}
    </div>
  );
}
