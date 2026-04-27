"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { pageCsvZipUrl, tableImageUrl, type TableData } from "@/lib/api";

interface Props {
  jobId: string;
  tables: TableData[];
}

interface ImageGroup {
  pageIndex: number;
  tables: TableData[];
}

export default function ImageResults({ jobId, tables }: Props) {
  const groups: ImageGroup[] = useMemo(() => {
    const byPage = new Map<number, TableData[]>();
    for (const t of tables) {
      const arr = byPage.get(t.page_index) ?? [];
      arr.push(t);
      byPage.set(t.page_index, arr);
    }
    return [...byPage.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([pageIndex, ts]) => ({
        pageIndex,
        tables: ts.sort((a, b) => a.index - b.index),
      }));
  }, [tables]);

  const [activeImg, setActiveImg] = useState(0);
  const [activeTable, setActiveTable] = useState(0);
  const safeImg = Math.min(activeImg, Math.max(0, groups.length - 1));
  const group = groups[safeImg];
  const safeTable = Math.min(activeTable, Math.max(0, (group?.tables.length ?? 1) - 1));
  const t = group?.tables[safeTable];

  // reset table index when image changes
  useEffect(() => {
    setActiveTable(0);
  }, [safeImg]);

  if (!group || !t) {
    return (
      <div className="glass rounded-2xl p-8 text-center text-[#9ca3af]">
        No tables yet. Confirm a page to populate results.
      </div>
    );
  }

  const tableCount = group.tables.length;

  return (
    <div className="glass rounded-2xl p-6 gradient-border">
      {/* Image-level nav */}
      <div className="flex items-center justify-center gap-3 mb-4 flex-wrap">
        <button
          onClick={() => setActiveImg((i) => Math.max(0, i - 1))}
          disabled={safeImg === 0}
          className="px-3 py-1.5 rounded-lg border border-[#00d4ff]/30 bg-[rgba(0,212,255,0.06)] hover:bg-[rgba(0,212,255,0.14)] hover:border-[#00d4ff] disabled:opacity-30 text-sm text-[#00d4ff]"
        >
          ← Prev image
        </button>
        <span className="font-mono text-sm text-white text-center">
          Image {safeImg + 1} / {groups.length}
          <span className="ml-2 text-xs text-[#6b7280]">
            (page {group.pageIndex + 1})
          </span>
        </span>
        <button
          onClick={() => setActiveImg((i) => Math.min(groups.length - 1, i + 1))}
          disabled={safeImg === groups.length - 1}
          className="px-3 py-1.5 rounded-lg border border-[#00d4ff]/30 bg-[rgba(0,212,255,0.06)] hover:bg-[rgba(0,212,255,0.14)] hover:border-[#00d4ff] disabled:opacity-30 text-sm text-[#00d4ff]"
        >
          Next image →
        </button>
        <span className="ml-3">
          <CsvDownloadMenu jobId={jobId} group={group} />
        </span>
      </div>

      {/* Table-level nav (only if more than one) */}
      {tableCount > 1 && (
        <div className="flex items-center justify-center gap-2 mb-5">
          <button
            onClick={() => setActiveTable((i) => Math.max(0, i - 1))}
            disabled={safeTable === 0}
            className="px-3 py-1 rounded-md border border-purple-400/40 bg-purple-500/10 hover:bg-purple-500/20 disabled:opacity-30 text-xs text-purple-200 font-mono"
          >
            ← Prev table
          </button>
          <span className="font-mono text-xs text-purple-200 text-center">
            Table {safeTable + 1} / {tableCount}
          </span>
          <button
            onClick={() => setActiveTable((i) => Math.min(tableCount - 1, i + 1))}
            disabled={safeTable === tableCount - 1}
            className="px-3 py-1 rounded-md border border-purple-400/40 bg-purple-500/10 hover:bg-purple-500/20 disabled:opacity-30 text-xs text-purple-200 font-mono"
          >
            Next table →
          </button>
        </div>
      )}

      {/* PNG | HTML side-by-side */}
      <div className="grid md:grid-cols-2 gap-5">
        <div>
          <p className="text-xs uppercase tracking-wider text-[#6b7280] mb-2 text-center">
            Cropped image
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={tableImageUrl(jobId, t.index)}
            alt={`Table ${t.index}`}
            className="rounded-lg border border-white/10 max-h-[28rem] w-full object-contain bg-black/30"
          />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-[#6b7280] mb-2 text-center">
            Recognized HTML
            <span className="ml-2 text-[#9ca3af] normal-case">
              · {t.cell_count} cells
            </span>
          </p>
          <div
            className="rounded-lg border border-white/10 bg-black/30 p-3 max-h-[28rem] overflow-auto text-sm text-white [&_table]:w-full [&_th]:bg-white/5 [&_th,&_td]:px-2 [&_th,&_td]:py-1 [&_th,&_td]:border [&_th,&_td]:border-white/10"
            dangerouslySetInnerHTML={{ __html: t.html }}
          />
        </div>
      </div>
    </div>
  );
}

function CsvDownloadMenu({ jobId, group }: { jobId: string; group: ImageGroup }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const single = group.tables.length === 1;

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  function downloadSingle(content: string, name: string) {
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  }

  function downloadCombined() {
    const combined = group.tables
      .map((t, i) => `# Table ${i + 1}\n${t.csv}`)
      .join("\n\n");
    downloadSingle(combined, `page_${group.pageIndex + 1}_combined.csv`);
  }

  if (single) {
    return (
      <button
        onClick={() => downloadSingle(group.tables[0].csv, `table_${group.tables[0].index}.csv`)}
        className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-400/40 hover:bg-emerald-500/25 text-xs font-mono text-emerald-200"
      >
        Download CSV
      </button>
    );
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-400/40 hover:bg-emerald-500/25 text-xs font-mono text-emerald-200"
      >
        Download CSV ▾
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-10 w-56 rounded-lg border border-white/10 bg-[#0f1116] shadow-xl overflow-hidden">
          <button
            onClick={downloadCombined}
            className="block w-full text-left px-3 py-2 text-xs font-mono text-white hover:bg-white/5"
          >
            One combined CSV
            <div className="text-[#6b7280] text-[10px] mt-0.5">
              all {group.tables.length} tables in one file
            </div>
          </button>
          <a
            href={pageCsvZipUrl(jobId, group.pageIndex)}
            download
            onClick={() => setOpen(false)}
            className="block w-full text-left px-3 py-2 text-xs font-mono text-white hover:bg-white/5 border-t border-white/10"
          >
            ZIP of CSVs
            <div className="text-[#6b7280] text-[10px] mt-0.5">
              one file per table
            </div>
          </a>
        </div>
      )}
    </div>
  );
}
