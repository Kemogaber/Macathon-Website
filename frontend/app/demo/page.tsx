"use client";

import { useEffect, useRef, useState } from "react";
import UploadZone from "@/components/UploadZone";
import QuadEditor, {
  quadToRect,
  rectToQuad,
  type RectQuad,
} from "@/components/QuadEditor";
import TableTabs from "@/components/TableTabs";
import {
  createJob,
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
  parsed: boolean;        // true once this page's tables have been parsed
  skipped: boolean;       // user marked the page as skipped (red X)
}

export default function DemoPage() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const [job, setJob] = useState<JobInit | null>(null);
  const [pageStates, setPageStates] = useState<PerPageState[]>([]);
  const [currentPage, setCurrentPage] = useState(0);

  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [tables, setTables] = useState<TableData[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------- step 1 → 2 : upload + detect ----------
  async function handleStartDetect() {
    if (!file) return;
    setErrorMsg("");
    setParsing(true);
    try {
      const j = await createJob(file);
      setJob(j);
      setPageStates(
        j.pages.map((p) => ({
          rects: p.detections.map((d) => quadToRect(d.quad)),
          activeRect: 0,
          parsed: false,
          skipped: false,
        })),
      );
      setCurrentPage(0);
      setTables([]);
      setStep("review");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Upload failed.");
      setStep("error");
    } finally {
      setParsing(false);
    }
  }

  // ---------- per-page editing ----------
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

  function toggleSkip(pageIdx: number) {
    setPageStates((prev) => {
      const next = [...prev];
      next[pageIdx] = { ...next[pageIdx], skipped: !next[pageIdx].skipped };
      return next;
    });
  }

  // ---------- parse a single page ----------
  async function parseCurrentPage() {
    if (!job || parsing) return;
    const ps = pageStates[currentPage];
    if (!ps || ps.parsed || ps.skipped || ps.rects.length === 0) return;

    const confirmed: ConfirmedQuad[] = ps.rects.map((r) => ({
      page_index: currentPage,
      quad: rectToQuad(r),
      score: 0,
    }));

    setParsing(true);
    setParseProgress(0);
    setErrorMsg("");
    try {
      await startRecognize(job.job_id, confirmed);
      pollRef.current = setInterval(async () => {
        try {
          const s: JobStatus = await getJobStatus(job.job_id);
          setParseProgress(s.progress);
          setTables(s.tables);
          if (s.status === "done") {
            if (pollRef.current) clearInterval(pollRef.current);
            setPageStates((prev) => {
              const next = [...prev];
              next[currentPage] = { ...next[currentPage], parsed: true };
              return next;
            });
            setParsing(false);
          } else if (s.status === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
            setErrorMsg(s.error ?? "Recognition failed.");
            setParsing(false);
          }
        } catch (e) {
          if (pollRef.current) clearInterval(pollRef.current);
          setErrorMsg(e instanceof Error ? e.message : "Polling failed.");
          setParsing(false);
        }
      }, 800);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to start parsing.");
      setParsing(false);
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
    setParsing(false);
    setParseProgress(0);
    setErrorMsg("");
  }

  // ---------- render ----------
  const parsedCount = pageStates.filter((p) => p.parsed).length;
  const skippedCount = pageStates.filter((p) => p.skipped).length;
  const ps = pageStates[currentPage];

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
                onClick={handleStartDetect}
                disabled={parsing}
                className="px-6 py-2.5 rounded-xl bg-[#00d4ff] text-[#0a0b0f] font-bold text-sm hover:bg-cyan-300 transition-colors glow-cyan disabled:opacity-50"
              >
                {parsing ? "Detecting…" : "Detect Tables →"}
              </button>
            </div>
          )}
        </div>
      )}

      {step === "review" && job && ps && (
        <div className="space-y-5">
          {/* page nav */}
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
                Page {currentPage + 1} / {job.pages.length}
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
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#6b7280] font-mono">
                {parsedCount} parsed · {skippedCount} skipped · {tables.length}{" "}
                tables so far
              </span>
              <button
                onClick={() => toggleSkip(currentPage)}
                disabled={ps.parsed}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-40 ${
                  ps.skipped
                    ? "bg-red-500/20 border border-red-500/40 text-red-300"
                    : "bg-white/5 border border-white/10 hover:border-red-400/40"
                }`}
                title="Skip this page"
              >
                {ps.skipped ? "✗ Skipped — click to undo" : "✗ Skip page"}
              </button>
            </div>
          </div>

          {/* editor */}
          <div
            className={`glass rounded-2xl p-5 ${ps.skipped ? "opacity-50" : ""}`}
          >
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <p className="text-xs uppercase tracking-wider text-[#6b7280]">
                {ps.parsed
                  ? "✓ Page parsed — locked. Navigate to another page."
                  : ps.skipped
                    ? "Page skipped. Toggle skip off to edit."
                    : `Drag edges/rotate to fit. ${ps.rects.length} table(s) on this page.`}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => addRect(currentPage)}
                  disabled={ps.parsed || ps.skipped}
                  className="px-3 py-1 rounded-lg border border-white/10 hover:border-[#00d4ff]/40 text-xs disabled:opacity-40"
                >
                  + Add table
                </button>
              </div>
            </div>

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
                    Table {ri + 1}
                  </button>
                  {!ps.parsed && !ps.skipped && (
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
                  No detections — use “+ Add table” to draw one.
                </span>
              )}
            </div>

            <QuadEditor
              imageUrl={pageImageUrl(job.job_id, currentPage)}
              imageWidth={job.pages[currentPage].width}
              imageHeight={job.pages[currentPage].height}
              rects={ps.rects}
              activeIndex={ps.activeRect}
              onRectChange={(ri, r) => setRect(currentPage, ri, r)}
              onRemove={(ri) => removeRect(currentPage, ri)}
              locked={ps.parsed || ps.skipped}
            />
          </div>

          {/* parse controls */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <button
              onClick={reset}
              className="text-xs text-[#6b7280] hover:text-white"
            >
              ← Start over
            </button>
            <div className="flex items-center gap-3">
              {parsing && (
                <span className="text-xs font-mono text-[#00d4ff]">
                  Parsing… {Math.round(parseProgress * 100)}%
                </span>
              )}
              <button
                onClick={parseCurrentPage}
                disabled={
                  parsing ||
                  ps.parsed ||
                  ps.skipped ||
                  ps.rects.length === 0
                }
                className="px-6 py-2.5 rounded-xl bg-[#00d4ff] text-[#0a0b0f] font-bold text-sm hover:bg-cyan-300 transition-colors glow-cyan disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {ps.parsed
                  ? "✓ Parsed"
                  : `Parse this page (${ps.rects.length})`}
              </button>
            </div>
          </div>

          {errorMsg && <p className="text-red-400 text-sm">{errorMsg}</p>}

          {/* incremental results */}
          {tables.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-lg font-bold text-white">
                  Results
                  <span className="ml-2 text-xs font-mono text-[#6b7280]">
                    {tables.length} table{tables.length === 1 ? "" : "s"} parsed
                  </span>
                </h2>
                <a
                  href={jobZipUrl(job.job_id)}
                  className="px-4 py-2 rounded-xl bg-[#00d4ff] text-[#0a0b0f] font-bold text-sm hover:bg-cyan-300 transition-colors glow-cyan"
                >
                  Download all (ZIP)
                </a>
              </div>
              <TableTabs jobId={job.job_id} tables={tables} forceCarousel />
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
  if (state.parsed) {
    return (
      <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-mono">
        ✓ Parsed
      </span>
    );
  }
  if (state.skipped) {
    return (
      <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 border border-red-500/30 text-xs font-mono">
        ✗ Skipped
      </span>
    );
  }
  return null;
}

function Stepper({ step, hasResults }: { step: Step; hasResults: boolean }) {
  const labels = [
    { id: "upload", label: "Upload" },
    { id: "review", label: "Review & Parse" },
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
