"use client";

import { useState } from "react";
import { tableImageUrl, type TableData } from "@/lib/api";

interface Props {
  jobId: string;
  tables: TableData[];
}

const TAB_LIMIT = 5;

export default function TableTabs({ jobId, tables }: Props) {
  const [active, setActive] = useState(0);

  if (tables.length === 0) {
    return (
      <div className="glass rounded-2xl p-8 text-center text-[#9ca3af]">
        No tables were extracted.
      </div>
    );
  }

  const useCarousel = tables.length > TAB_LIMIT;
  const t = tables[active];

  function downloadCsv() {
    const blob = new Blob([t.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `table_${t.index}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="glass rounded-2xl p-6 gradient-border">
      {/* Selector */}
      {useCarousel ? (
        <div className="flex items-center justify-between mb-5">
          <button
            onClick={() => setActive((i) => Math.max(0, i - 1))}
            disabled={active === 0}
            className="px-3 py-1.5 rounded-lg border border-white/10 hover:border-[#00d4ff]/40 disabled:opacity-30 text-sm"
          >
            ← Prev
          </button>
          <span className="font-mono text-sm text-[#9ca3af]">
            Table {active + 1} / {tables.length}
          </span>
          <button
            onClick={() => setActive((i) => Math.min(tables.length - 1, i + 1))}
            disabled={active === tables.length - 1}
            className="px-3 py-1.5 rounded-lg border border-white/10 hover:border-[#00d4ff]/40 disabled:opacity-30 text-sm"
          >
            Next →
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 mb-5">
          {tables.map((tab, i) => (
            <button
              key={tab.index}
              onClick={() => setActive(i)}
              className={`px-4 py-1.5 rounded-lg text-sm font-mono border transition-colors ${
                i === active
                  ? "border-[#00d4ff] bg-[rgba(0,212,255,0.12)] text-[#00d4ff]"
                  : "border-white/10 text-[#9ca3af] hover:border-white/30"
              }`}
            >
              Table {tab.index}
            </button>
          ))}
        </div>
      )}

      {/* Crop preview */}
      <div className="grid md:grid-cols-2 gap-5 mb-5">
        <div>
          <p className="text-xs uppercase tracking-wider text-[#6b7280] mb-2">Cropped image</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={tableImageUrl(jobId, t.index)}
            alt={`Table ${t.index}`}
            className="rounded-lg border border-white/10 max-h-72 object-contain bg-black/30"
          />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-[#6b7280] mb-2">Recognized data</p>
          <div
            className="rounded-lg border border-white/10 bg-black/30 p-3 max-h-72 overflow-auto text-sm text-white [&_table]:w-full [&_th]:bg-white/5 [&_th,&_td]:px-2 [&_th,&_td]:py-1 [&_th,&_td]:border [&_th,&_td]:border-white/10"
            dangerouslySetInnerHTML={{ __html: t.html }}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={downloadCsv}
          className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:border-[#00d4ff]/40 text-sm"
        >
          Download CSV
        </button>
        <a
          href={tableImageUrl(jobId, t.index)}
          download={`table_${t.index}.png`}
          className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:border-[#00d4ff]/40 text-sm"
        >
          Download PNG
        </a>
        <span className="ml-auto text-xs text-[#6b7280] self-center font-mono">
          {t.cell_count} cells
        </span>
      </div>
    </div>
  );
}
