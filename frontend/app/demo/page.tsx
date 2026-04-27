"use client";

import { useEffect, useRef, useState } from "react";
import UploadZone from "@/components/UploadZone";
import QuadEditor from "@/components/QuadEditor";
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
  type Quad,
} from "@/lib/api";

type Step = "upload" | "review" | "processing" | "results" | "error";

interface PerPageState {
  quads: Quad[];           // editable copies of detected quads, plus any user-added
  confirmed: boolean;
  activeQuad: number;
}

export default function DemoPage() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const [job, setJob] = useState<JobInit | null>(null);
  const [pageStates, setPageStates] = useState<PerPageState[]>([]);
  const [currentPage, setCurrentPage] = useState(0);

  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------- step 1 → 2 : upload + detect ----------
  async function handleStartDetect() {
    if (!file) return;
    setStep("processing");
    setProgress(0);
    setErrorMsg("");
    try {
      const j = await createJob(file);
      setJob(j);
      setPageStates(
        j.pages.map((p) => ({
          quads: p.detections.map((d) => d.quad),
          confirmed: false,
          activeQuad: 0,
        })),
      );
      setCurrentPage(0);
      setStep("review");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Upload failed.");
      setStep("error");
    }
  }

  // ---------- step 2 → 3 : confirm + recognize ----------
  function setQuad(pageIdx: number, quadIdx: number, quad: Quad) {
    setPageStates((prev) => {
      const next = [...prev];
      const p = { ...next[pageIdx] };
      p.quads = [...p.quads];
      p.quads[quadIdx] = quad;
      next[pageIdx] = p;
      return next;
    });
  }

  function toggleConfirm(pageIdx: number) {
    setPageStates((prev) => {
      const next = [...prev];
      next[pageIdx] = { ...next[pageIdx], confirmed: !next[pageIdx].confirmed };
      return next;
    });
  }

  function setActiveQuad(pageIdx: number, qi: number) {
    setPageStates((prev) => {
      const next = [...prev];
      next[pageIdx] = { ...next[pageIdx], activeQuad: qi };
      return next;
    });
  }

  function removeQuad(pageIdx: number, qi: number) {
    setPageStates((prev) => {
      const next = [...prev];
      const p = { ...next[pageIdx] };
      p.quads = p.quads.filter((_, i) => i !== qi);
      p.activeQuad = Math.max(0, Math.min(p.activeQuad, p.quads.length - 1));
      next[pageIdx] = p;
      return next;
    });
  }

  function addQuad(pageIdx: number) {
    if (!job) return;
    const page = job.pages[pageIdx];
    const w = page.width;
    const h = page.height;
    const margin = Math.min(w, h) * 0.15;
    const newQuad: Quad = [
      [margin, margin],
      [w - margin, margin],
      [w - margin, h - margin],
      [margin, h - margin],
    ];
    setPageStates((prev) => {
      const next = [...prev];
      const p = { ...next[pageIdx] };
      p.quads = [...p.quads, newQuad];
      p.activeQuad = p.quads.length - 1;
      next[pageIdx] = p;
      return next;
    });
  }

  async function handleProcess() {
    if (!job) return;
    const confirmed: ConfirmedQuad[] = [];
    pageStates.forEach((p, idx) => {
      if (!p.confirmed) return;
      const detected = job.pages[idx].detections;
      p.quads.forEach((q, qi) => {
        const score = detected[qi]?.score;
        confirmed.push({
          page_index: idx,
          quad: q,
          score: typeof score === "number" ? score : 0,
        });
      });
    });
    if (confirmed.length === 0) {
      setErrorMsg("Confirm at least one page before processing.");
      return;
    }

    setStep("processing");
    setProgress(0);
    setErrorMsg("");
    try {
      await startRecognize(job.job_id, confirmed);
      pollRef.current = setInterval(async () => {
        try {
          const s = await getJobStatus(job.job_id);
          setStatus(s);
          setProgress(s.progress);
          if (s.status === "done") {
            if (pollRef.current) clearInterval(pollRef.current);
            setStep("results");
          } else if (s.status === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
            setErrorMsg(s.error ?? "Recognition failed.");
            setStep("error");
          }
        } catch (e) {
          if (pollRef.current) clearInterval(pollRef.current);
          setErrorMsg(e instanceof Error ? e.message : "Polling failed.");
          setStep("error");
        }
      }, 1000);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to start processing.");
      setStep("error");
    }
  }

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  function reset() {
    setStep("upload");
    setFile(null);
    setJob(null);
    setPageStates([]);
    setCurrentPage(0);
    setStatus(null);
    setProgress(0);
    setErrorMsg("");
  }

  // ---------- render ----------
  const confirmedCount = pageStates.filter((p) => p.confirmed).length;
  const totalQuads = pageStates.reduce(
    (sum, p) => sum + (p.confirmed ? p.quads.length : 0),
    0,
  );

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <div className="text-center mb-10">
        <span className="inline-block px-3 py-1 rounded-full border border-[#00d4ff]/20 bg-[rgba(0,212,255,0.1)] text-[#00d4ff] text-xs font-mono mb-4">
          Live Demo
        </span>
        <h1 className="text-4xl font-black text-white mb-3">Table Extractor</h1>
        <Stepper step={step} />
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
                className="px-6 py-2.5 rounded-xl bg-[#00d4ff] text-[#0a0b0f] font-bold text-sm hover:bg-cyan-300 transition-colors glow-cyan"
              >
                Detect Tables →
              </button>
            </div>
          )}
        </div>
      )}

      {step === "review" && job && pageStates[currentPage] && (
        <div className="space-y-5">
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
                onClick={() => setCurrentPage((i) => Math.min(job.pages.length - 1, i + 1))}
                disabled={currentPage === job.pages.length - 1}
                className="px-3 py-1.5 rounded-lg border border-white/10 hover:border-[#00d4ff]/40 disabled:opacity-30 text-sm"
              >
                Next →
              </button>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-[#6b7280] font-mono">
                {confirmedCount} / {job.pages.length} pages confirmed · {totalQuads} tables
              </span>
              <button
                onClick={() => toggleConfirm(currentPage)}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${
                  pageStates[currentPage].confirmed
                    ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-300"
                    : "bg-[#00d4ff] text-[#0a0b0f] hover:bg-cyan-300"
                }`}
              >
                {pageStates[currentPage].confirmed ? "✓ Confirmed" : "Confirm Page"}
              </button>
            </div>
          </div>

          <div className="glass rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs uppercase tracking-wider text-[#6b7280]">
                Adjust the blue corners. {pageStates[currentPage].quads.length} table(s) on this page.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => addQuad(currentPage)}
                  className="px-3 py-1 rounded-lg border border-white/10 hover:border-[#00d4ff]/40 text-xs"
                >
                  + Add quad
                </button>
                {pageStates[currentPage].quads.length > 0 && (
                  <button
                    onClick={() =>
                      removeQuad(currentPage, pageStates[currentPage].activeQuad)
                    }
                    className="px-3 py-1 rounded-lg border border-white/10 hover:border-red-400/40 text-xs"
                  >
                    − Remove active
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              {pageStates[currentPage].quads.map((_, qi) => (
                <button
                  key={qi}
                  onClick={() => setActiveQuad(currentPage, qi)}
                  className={`px-3 py-1 rounded-lg text-xs font-mono border transition-colors ${
                    qi === pageStates[currentPage].activeQuad
                      ? "border-[#00d4ff] bg-[rgba(0,212,255,0.12)] text-[#00d4ff]"
                      : "border-white/10 text-[#9ca3af] hover:border-white/30"
                  }`}
                >
                  Quad {qi + 1}
                </button>
              ))}
              {pageStates[currentPage].quads.length === 0 && (
                <span className="text-xs text-[#6b7280] font-mono">
                  No detections — use “+ Add quad” to draw one.
                </span>
              )}
            </div>

            <div className="flex justify-center bg-black/40 rounded-xl p-3">
              <QuadEditor
                imageUrl={pageImageUrl(job.job_id, currentPage)}
                imageWidth={job.pages[currentPage].width}
                imageHeight={job.pages[currentPage].height}
                quads={pageStates[currentPage].quads}
                activeQuadIndex={pageStates[currentPage].activeQuad}
                onQuadChange={(qi, q) => setQuad(currentPage, qi, q)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <button
              onClick={reset}
              className="text-xs text-[#6b7280] hover:text-white"
            >
              ← Start over
            </button>
            <button
              onClick={handleProcess}
              disabled={confirmedCount === 0}
              className="px-6 py-2.5 rounded-xl bg-[#00d4ff] text-[#0a0b0f] font-bold text-sm hover:bg-cyan-300 transition-colors glow-cyan disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Process {totalQuads} table{totalQuads === 1 ? "" : "s"} →
            </button>
          </div>
          {errorMsg && <p className="text-red-400 text-sm">{errorMsg}</p>}
        </div>
      )}

      {step === "processing" && (
        <div className="glass rounded-2xl p-10 text-center max-w-xl mx-auto">
          <div className="inline-flex items-center gap-3 text-[#00d4ff] mb-4">
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span className="font-mono text-sm">
              {job ? "Recognizing tables…" : "Detecting tables…"}
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full bg-[#00d4ff] transition-all"
              style={{ width: `${Math.max(5, progress * 100)}%` }}
            />
          </div>
          <p className="text-[#6b7280] text-xs mt-3 font-mono">
            {Math.round(progress * 100)}%
            {status?.tables.length ? ` · ${status.tables.length} table(s) so far` : ""}
          </p>
        </div>
      )}

      {step === "results" && job && status && (
        <div className="space-y-5">
          <TableTabs jobId={job.job_id} tables={status.tables} />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <button onClick={reset} className="text-xs text-[#6b7280] hover:text-white">
              ← Start over
            </button>
            <a
              href={jobZipUrl(job.job_id)}
              className="px-6 py-2.5 rounded-xl bg-[#00d4ff] text-[#0a0b0f] font-bold text-sm hover:bg-cyan-300 transition-colors glow-cyan"
            >
              Download all (ZIP)
            </a>
          </div>
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

function Stepper({ step }: { step: Step }) {
  const labels: { id: Step; label: string }[] = [
    { id: "upload", label: "Upload" },
    { id: "review", label: "Review" },
    { id: "results", label: "Results" },
  ];
  const stepRank: Record<Step, number> = {
    upload: 0,
    review: 1,
    processing: 1,
    results: 2,
    error: 0,
  };
  const active = stepRank[step];
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
