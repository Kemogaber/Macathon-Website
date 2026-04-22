"use client";

import { useState } from "react";
import UploadZone from "@/components/UploadZone";
import ResultTable from "@/components/ResultTable";
import DownloadButtons from "@/components/DownloadButtons";
import { extractTable, type ExtractionResult } from "@/lib/api";

type Status = "idle" | "loading" | "success" | "error";

export default function DemoPage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  async function handleExtract() {
    if (!file) return;
    setStatus("loading");
    setResult(null);
    setErrorMsg("");
    try {
      const data = await extractTable(file);
      setResult(data);
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Extraction failed.");
      setStatus("error");
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      {/* Header */}
      <div className="text-center mb-12">
        <span className="inline-block px-3 py-1 rounded-full border border-[#00d4ff]/20 bg-[rgba(0,212,255,0.1)] text-[#00d4ff] text-xs font-mono mb-4">
          Live Demo
        </span>
        <h1 className="text-4xl font-black text-white mb-3">Table Extractor</h1>
        <p className="text-[#9ca3af]">
          Upload an image containing a table and get structured HTML and CSV output instantly.
        </p>
      </div>

      {/* Upload card */}
      <div className="glass rounded-2xl p-7 gradient-border mb-6">
        <UploadZone onFileSelect={setFile} disabled={status === "loading"} />

        {file && (
          <div className="mt-5 flex items-center justify-between gap-4 flex-wrap">
            <p className="text-sm text-[#9ca3af] font-mono truncate max-w-xs">
              {file.name} · {(file.size / 1024).toFixed(1)} KB
            </p>
            <button
              onClick={handleExtract}
              disabled={status === "loading"}
              className="px-6 py-2.5 rounded-xl bg-[#00d4ff] text-[#0a0b0f] font-bold text-sm hover:bg-cyan-300 transition-colors glow-cyan disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === "loading" ? "Extracting…" : "Extract Table →"}
            </button>
          </div>
        )}
      </div>

      {/* Loading */}
      {status === "loading" && (
        <div className="glass rounded-2xl p-10 text-center">
          <div className="inline-flex items-center gap-3 text-[#00d4ff]">
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span className="font-mono text-sm">Running AI pipeline…</span>
          </div>
          <p className="text-[#6b7280] text-xs mt-3">Detection · Structure · OCR</p>
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div className="glass rounded-2xl p-6 border border-red-500/20 bg-red-500/5">
          <p className="text-red-400 font-medium">⚠ Extraction failed</p>
          <p className="text-[#9ca3af] text-sm mt-1">{errorMsg}</p>
          <button
            onClick={() => setStatus("idle")}
            className="mt-4 text-xs text-[#6b7280] hover:text-white transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {/* Result */}
      {status === "success" && result && (
        <div className="space-y-5">
          <ResultTable
            html={result.html}
            csv={result.csv}
            tableCount={result.table_count}
            processingMs={result.processing_time_ms}
          />
          <DownloadButtons html={result.html} csv={result.csv} />
        </div>
      )}
    </div>
  );
}
