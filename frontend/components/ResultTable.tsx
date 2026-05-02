"use client";

import { useState } from "react";

interface Props {
  html: string;
  csv: string;
  tableCount: number;
  processingMs: number;
}

export default function ResultTable({ html, csv, tableCount, processingMs }: Props) {
  const [tab, setTab] = useState<"html" | "csv">("html");

  return (
    <div className="glass rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-text">
            {tableCount} table{tableCount !== 1 ? "s" : ""} extracted
          </span>
          <span className="text-xs font-mono text-muted">
            {processingMs} ms
          </span>
        </div>
        <div className="flex items-center gap-1 bg-overlay rounded-lg p-1">
          {(["html", "csv"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                tab === t
                  ? "bg-cyan text-background"
                  : "text-muted-2 hover:text-text"
              }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-5 overflow-auto max-h-[420px]">
        {tab === "html" ? (
          <div
            className="extracted-table text-sm text-text/90"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="text-sm text-cyan font-mono whitespace-pre-wrap break-all">
            {csv}
          </pre>
        )}
      </div>

      <style>{`
        .extracted-table table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.875rem;
        }
        .extracted-table th,
        .extracted-table td {
          padding: 8px 12px;
          border: 1px solid var(--border);
          text-align: left;
        }
        .extracted-table thead tr {
          background: var(--cyan-dim);
          color: var(--cyan);
        }
        .extracted-table tbody tr:hover {
          background: var(--overlay);
        }
      `}</style>
    </div>
  );
}
