"use client";

import { useMemo, useState } from "react";
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
      .map(([pageIndex, ts]) => ({ pageIndex, tables: ts.sort((a, b) => a.index - b.index) }));
  }, [tables]);

  const [active, setActive] = useState(0);
  const safeActive = Math.min(active, Math.max(0, groups.length - 1));
  const group = groups[safeActive];

  if (!group) {
    return (
      <div className="glass rounded-2xl p-8 text-center text-[#9ca3af]">
        No tables yet. Confirm a page to populate results.
      </div>
    );
  }

  const multiTable = group.tables.length > 1;

  return (
    <div className="glass rounded-2xl p-6 gradient-border">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActive((i) => Math.max(0, i - 1))}
            disabled={safeActive === 0}
            className="px-3 py-1.5 rounded-lg border border-white/10 hover:border-[#00d4ff]/40 disabled:opacity-30 text-sm"
          >
            ← Prev
          </button>
          <span className="font-mono text-sm text-[#9ca3af]">
            Image {safeActive + 1} / {groups.length}
          </span>
          <button
            onClick={() => setActive((i) => Math.min(groups.length - 1, i + 1))}
            disabled={safeActive === groups.length - 1}
            className="px-3 py-1.5 rounded-lg border border-white/10 hover:border-[#00d4ff]/40 disabled:opacity-30 text-sm"
          >
            Next →
          </button>
          <span className="text-xs text-[#6b7280] font-mono">
            Page {group.pageIndex + 1} · {group.tables.length} table
            {group.tables.length === 1 ? "" : "s"}
          </span>
        </div>
        <a
          href={pageCsvZipUrl(jobId, group.pageIndex)}
          className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:border-[#00d4ff]/40 text-xs font-mono"
          download
        >
          {multiTable ? "Download CSVs (.zip)" : "Download CSV"}
        </a>
      </div>

      <div className="space-y-8">
        {group.tables.map((t, i) => (
          <div key={t.index}>
            {i > 0 && <div className="border-t border-white/10 my-6" />}
            <h3 className="text-base font-bold text-white mb-3">
              Table {i + 1}
              <span className="ml-2 text-xs font-mono text-[#6b7280]">
                ({t.cell_count} cells)
              </span>
            </h3>
            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <p className="text-xs uppercase tracking-wider text-[#6b7280] mb-2">
                  Cropped image
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={tableImageUrl(jobId, t.index)}
                  alt={`Table ${t.index}`}
                  className="rounded-lg border border-white/10 max-h-72 object-contain bg-black/30"
                />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-[#6b7280] mb-2">
                  Recognized HTML
                </p>
                <div
                  className="rounded-lg border border-white/10 bg-black/30 p-3 max-h-72 overflow-auto text-sm text-white [&_table]:w-full [&_th]:bg-white/5 [&_th,&_td]:px-2 [&_th,&_td]:py-1 [&_th,&_td]:border [&_th,&_td]:border-white/10"
                  dangerouslySetInnerHTML={{ __html: t.html }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
