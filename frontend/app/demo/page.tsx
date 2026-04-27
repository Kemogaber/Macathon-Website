"use client";

import UploadZone from "@/components/UploadZone";
import QuadEditor, {
  quadToRect,
  rectToQuad,
  type RectQuad,
} from "@/components/QuadEditor";
import ImageResults from "@/components/ImageResults";
import {
  cancelJob,
  createJob,
  detectPages,
  getJobStatus,
  jobCsvUrl,
  jobZipUrl,
  pageImageUrl,
  startRecognize,
  type ConfirmedQuad,
  type JobStatus,
} from "@/lib/api";
import { useDemoStore, type PerPageState, type Step } from "@/lib/demoStore";
import { useEffect, useState } from "react";

export default function DemoPage() {
  const {
    step,
    files,
    job,
    pageStates,
    currentPage,
    tables,
    errorMsg,
    busy,
    confirmProgress,
    setStep,
    setFiles,
    setJob,
    setPageStates,
    setCurrentPage,
    setTables,
    setErrorMsg,
    setBusy,
    setConfirmProgress,
    reset,
    pollRef,
  } = useDemoStore();

  const [pageInput, setPageInput] = useState("");
  useEffect(() => {
    setPageInput(String(currentPage + 1));
  }, [currentPage]);

  function jumpToPageFromInput() {
    if (!job) return;
    const n = parseInt(pageInput, 10);
    if (isNaN(n)) return;
    const clamped = Math.max(1, Math.min(job.pages.length, n));
    setCurrentPage(clamped - 1);
  }

  async function handleCancel() {
    if (!job || !busy) return;
    if (busy === "upload") {
      // The upload fetch already ran by the time poll/recognize starts;
      // we can't abort the streamed body retroactively. Just clear UI busy.
      setBusy(null);
      return;
    }
    try {
      await cancelJob(job.job_id);
    } catch {}
    if (pollRef.current) clearInterval(pollRef.current);
    setBusy(null);
    setErrorMsg("Cancelled.");
  }

  // ---------- step 1 → 2 : upload only (no auto-detect) ----------
  async function handleUpload() {
    if (!files.length) return;
    setErrorMsg("");
    setBusy("upload");
    try {
      const j = await createJob(files);
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
          if (next[rp.index].recognized) continue;
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
            if (s.error) setErrorMsg(`Some tables failed: ${s.error}`);
            setBusy(null);
          } else if (s.status === "cancelled") {
            if (pollRef.current) clearInterval(pollRef.current);
            setErrorMsg("Cancelled.");
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
      // Don't clear on unmount — user may navigate to another tab and back.
      // The interval is owned by the provider's pollRef and cleaned on reset.
    },
    [],
  );

  // Preload neighbor page images so arrow nav is instant.
  useEffect(() => {
    if (!job) return;
    const targets = [currentPage - 1, currentPage + 1].filter(
      (i) => i >= 0 && i < job.pages.length,
    );
    for (const i of targets) {
      const img = new Image();
      img.src = pageImageUrl(job.job_id, i);
    }
  }, [job, currentPage]);

  // Arrow keys navigate pages while in review
  useEffect(() => {
    if (step !== "review" || !job) return;
    function isTyping() {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable
      );
    }
    function onKey(e: KeyboardEvent) {
      if (isTyping()) return;
      if (!job) return;
      if (e.key === "ArrowLeft") {
        setCurrentPage((i: number) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight") {
        setCurrentPage((i: number) => Math.min(job.pages.length - 1, i + 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, job, setCurrentPage]);

  const ps = pageStates[currentPage];
  const detectedCount = pageStates.filter((p) => p.detected).length;
  const recognizedCount = pageStates.filter((p) => p.recognized).length;
  const confirmableCount = pageStates.filter(
    (p) => p.detected && !p.recognized && p.rects.length > 0,
  ).length;
  const undetectedCount = pageStates.filter(
    (p) => !p.detected && !p.recognized,
  ).length;

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="text-center mb-10">
        <span className="inline-block px-3 py-1 rounded-full border border-cyan/20 bg-[rgba(0,212,255,0.1)] text-cyan text-xs font-mono mb-4">
          Live Demo
        </span>
        <h1 className="text-4xl font-black text-text mb-3">Table Extractor</h1>
        <Stepper step={step} hasResults={tables.length > 0} />
      </div>

      {step === "upload" && (
        <div className="glass rounded-2xl p-7 gradient-border max-w-3xl mx-auto">
          <UploadZone files={files} onChange={setFiles} disabled={busy !== null} />
          {files.length > 0 && (
            <div className="mt-5 flex items-center justify-between gap-4 flex-wrap">
              <p className="text-sm text-muted-2 font-mono">
                {files.length} file{files.length === 1 ? "" : "s"} ready
              </p>
              <button
                onClick={handleUpload}
                disabled={busy !== null}
                className="px-6 py-2.5 rounded-xl bg-cyan text-background font-bold text-sm hover:bg-cyan-300 transition-colors glow-cyan disabled:opacity-50"
              >
                {busy === "upload" ? "Uploading…" : `Upload ${files.length} →`}
              </button>
            </div>
          )}
        </div>
      )}

      {step === "review" && job && ps && (
        <div className="space-y-5">
          {/* page nav with scrubber */}
          <div className="glass rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <button
                onClick={() => setCurrentPage((i: number) => Math.max(0, i - 1))}
                disabled={currentPage === 0}
                className="px-3 py-1.5 rounded-lg border border-cyan/30 bg-[rgba(0,212,255,0.06)] hover:bg-[rgba(0,212,255,0.14)] hover:border-cyan disabled:opacity-30 text-sm text-cyan"
              >
                ← Prev
              </button>
              <span className="font-mono text-sm text-text text-center inline-flex items-center gap-1">
                Image
                <input
                  type="number"
                  min={1}
                  max={job.pages.length}
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") jumpToPageFromInput();
                  }}
                  onBlur={jumpToPageFromInput}
                  className="w-16 text-center bg-overlay border border-border rounded-md px-1 py-0.5 font-mono text-text focus:outline-none focus:border-cyan"
                />
                / {job.pages.length}
              </span>
              <button
                onClick={() =>
                  setCurrentPage((i: number) =>
                    Math.min(job.pages.length - 1, i + 1),
                  )
                }
                disabled={currentPage === job.pages.length - 1}
                className="px-3 py-1.5 rounded-lg border border-cyan/30 bg-[rgba(0,212,255,0.06)] hover:bg-[rgba(0,212,255,0.14)] hover:border-cyan disabled:opacity-30 text-sm text-cyan"
              >
                Next →
              </button>
              <PageStatusBadge state={ps} />
              <span className="text-xs text-muted font-mono">
                {detectedCount} parsed · {recognizedCount} confirmed
              </span>
            </div>
            {job.pages.length > 1 && (
              <input
                type="range"
                min={0}
                max={job.pages.length - 1}
                value={currentPage}
                onChange={(e) => setCurrentPage(parseInt(e.target.value, 10))}
                className="w-full accent-cyan"
                aria-label="Page scrubber"
              />
            )}
          </div>

          {/* editor card — Step 1 detect controls + box pills + image */}
          <div className="glass rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <span className="text-xs uppercase tracking-wider text-muted-2">
                Step 1 — Detect tables
              </span>
              <button
                onClick={() => runDetection("one")}
                disabled={busy !== null || ps.detected || ps.recognized}
                className="px-4 py-2 rounded-lg bg-sky-500/15 border border-sky-400/40 hover:bg-sky-500/25 text-sky-100 light:text-sky-700 text-sm font-bold disabled:opacity-40"
                title={
                  ps.detected
                    ? "Already parsed — adjust boxes or click Confirm"
                    : ""
                }
              >
                {busy === "detect-one"
                  ? "Parsing…"
                  : ps.detected
                    ? "✓ Parsed"
                    : "Parse this image"}
              </button>
              <button
                onClick={() => runDetection("all")}
                disabled={busy !== null || undetectedCount === 0}
                className="px-4 py-2 rounded-lg bg-indigo-500/15 border border-indigo-400/40 hover:bg-indigo-500/25 text-indigo-100 light:text-indigo-700 text-sm font-bold disabled:opacity-40"
                title={
                  undetectedCount === 0 ? "All images already parsed" : ""
                }
              >
                {busy === "detect-all"
                  ? "Parsing all…"
                  : `Parse all (${undetectedCount})`}
              </button>
              <button
                onClick={() => addRect(currentPage)}
                disabled={ps.recognized}
                className="px-3 py-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 light:text-emerald-700 text-xs disabled:opacity-40"
              >
                + Add box
              </button>
            </div>

            <p className="text-xs uppercase tracking-wider text-muted text-center">
              {ps.recognized
                ? "✓ Confirmed — locked. Use arrows to navigate."
                : ps.detected
                  ? `Drag edges/rotate to fit. ${ps.rects.length} box(es).`
                  : "Not parsed yet — click “Parse this image” to detect tables."}
            </p>

            {ps.detected && (
              <div className="flex flex-wrap justify-center gap-2 mb-4">
                {ps.rects.map((_, ri) => (
                  <span
                    key={ri}
                    className={`inline-flex items-center gap-1 rounded-lg text-xs font-mono border transition-colors ${
                      ri === ps.activeRect
                        ? "border-cyan bg-[rgba(0,212,255,0.12)] text-cyan"
                        : "border-border text-muted-2"
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
                  <span className="text-xs text-muted font-mono">
                    No tables detected. Use “+ Add box” to draw one.
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

          {/* Step 2 — confirm */}
          <div className="glass rounded-2xl p-4 flex items-center justify-center gap-3 flex-wrap">
            <span className="text-xs uppercase tracking-wider text-muted-2">
              Step 2 — Confirm (TSR + OCR)
            </span>
            <button
              onClick={() => runConfirm("one")}
              disabled={
                busy !== null ||
                !ps.detected ||
                ps.recognized ||
                ps.rects.length === 0
              }
              className="px-4 py-2 rounded-lg bg-cyan text-background font-bold text-sm hover:bg-cyan-300 transition-colors glow-cyan disabled:opacity-40"
            >
              {busy === "confirm-one" ? "Confirming…" : "Confirm this image"}
            </button>
            <button
              onClick={() => runConfirm("all")}
              disabled={busy !== null || confirmableCount === 0}
              className="px-4 py-2 rounded-lg bg-fuchsia-500/15 border border-fuchsia-400/40 hover:bg-fuchsia-500/25 text-fuchsia-100 light:text-fuchsia-700 text-sm font-bold disabled:opacity-40"
            >
              {busy === "confirm-all"
                ? "Confirming all…"
                : `Confirm all (${confirmableCount})`}
            </button>
            {(busy === "confirm-one" || busy === "confirm-all") && (
              <span className="text-xs font-mono text-cyan">
                {Math.round(confirmProgress * 100)}%
              </span>
            )}
            {busy && (
              <button
                onClick={handleCancel}
                className="px-3 py-2 rounded-lg bg-red-500/15 border border-red-400/40 hover:bg-red-500/25 text-red-200 light:text-red-700 text-sm font-bold"
              >
                Cancel
              </button>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <button
              onClick={reset}
              className="text-xs text-muted hover:text-text"
            >
              ← Start over
            </button>
            {tables.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href={jobCsvUrl(job.job_id)}
                  className="px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-400/40 hover:bg-emerald-500/25 text-emerald-200 light:text-emerald-700 text-sm font-bold"
                >
                  Download one CSV
                </a>
                <a
                  href={jobZipUrl(job.job_id)}
                  className="px-4 py-2 rounded-xl bg-amber-500/15 border border-amber-400/40 hover:bg-amber-500/25 text-amber-100 light:text-amber-700 text-sm font-bold"
                >
                  Download ZIP of CSVs
                </a>
              </div>
            )}
          </div>

          {errorMsg && (
            <p className="text-yellow-300 light:text-yellow-700 text-sm text-center">{errorMsg}</p>
          )}

          {tables.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-bold text-text text-center">
                Results
                <span className="ml-2 text-xs font-mono text-muted">
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
          <p className="text-muted-2 text-sm mt-1">{errorMsg}</p>
          <button
            onClick={reset}
            className="mt-4 px-4 py-2 rounded-lg border border-border hover:border-cyan/40 text-sm"
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
      <span className="px-2 py-0.5 rounded-full bg-[rgba(0,212,255,0.12)] text-cyan border border-cyan/30 text-xs font-mono">
        ● Parsed
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-full bg-overlay text-muted-2 border border-border text-xs font-mono">
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
                ? "border-cyan/40 bg-[rgba(0,212,255,0.12)] text-cyan"
                : "border-border text-muted"
            }`}
          >
            {i + 1}. {l.label}
          </span>
          {i < labels.length - 1 && <span className="text-muted">—</span>}
        </div>
      ))}
    </div>
  );
}
