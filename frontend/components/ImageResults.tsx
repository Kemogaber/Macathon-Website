"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import EditableTable from "@/components/EditableTable";
import {
  pageCsvZipUrl,
  tableImageUrl,
  type CellData,
  type TableData,
} from "@/lib/api";
import { useToast } from "@/lib/toast";

interface Props {
  jobId: string;
  tables: TableData[];
}

interface ImageGroup {
  pageIndex: number;
  tables: TableData[];
}

function escapeCsv(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function csvFromCells(cells: CellData[], fallback: string): string {
  if (!cells.length) return fallback;
  const rows = Math.max(...cells.map((c) => c.row + (c.rowspan ?? 1)));
  const cols = Math.max(...cells.map((c) => c.col + (c.colspan ?? 1)));
  const grid: string[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(""),
  );
  for (const c of cells) {
    if (c.row < rows && c.col < cols) grid[c.row][c.col] = c.text ?? "";
  }
  return grid.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlFromCells(cells: CellData[], fallback: string): string {
  if (!cells.length) return fallback;
  const rows = Math.max(...cells.map((c) => c.row + (c.rowspan ?? 1)));
  // Mark which cell starts at each (r,c); skip cells covered by spans.
  const covered: boolean[][] = Array.from({ length: rows }, () => []);
  const startMap = new Map<string, CellData>();
  for (const c of cells) startMap.set(`${c.row},${c.col}`, c);

  const out: string[] = ["<table>"];
  for (let r = 0; r < rows; r++) {
    out.push("<tr>");
    let c = 0;
    while (true) {
      const cell = startMap.get(`${r},${c}`);
      if (cell) {
        const rs = cell.rowspan ?? 1;
        const cs = cell.colspan ?? 1;
        const attrs = [
          rs > 1 ? ` rowspan="${rs}"` : "",
          cs > 1 ? ` colspan="${cs}"` : "",
        ].join("");
        out.push(`<td${attrs}>${escapeHtml(cell.text ?? "")}</td>`);
        for (let dr = 0; dr < rs; dr++) {
          for (let dc = 0; dc < cs; dc++) {
            covered[r + dr] = covered[r + dr] || [];
            covered[r + dr][c + dc] = true;
          }
        }
        c += cs;
      } else if (covered[r]?.[c]) {
        c++;
      } else {
        break;
      }
    }
    out.push("</tr>");
  }
  out.push("</table>");
  return out.join("");
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
  const [showConfidence, setShowConfidence] = useState(false);
  const [edits, setEdits] = useState<Record<number, CellData[]>>({});
  const toast = useToast();

  useEffect(() => {
    setEdits((prev) => {
      const next = { ...prev };
      for (const t of tables) {
        if (!next[t.index] && t.cells)
          next[t.index] = t.cells.map((c) => ({ ...c }));
      }
      return next;
    });
  }, [tables]);

  // Listen for chat-suggested patches. The chat sends `tableIndex` as the
  // 1-based position in the attached context (same as job.tables order),
  // not TableResult.index — look up the actual TableResult here.
  useEffect(() => {
    function onPatch(e: Event) {
      const ce = e as CustomEvent<{
        tableIndex: number;
        row: number;
        col: number;
        value: string;
      }>;
      const d = ce.detail;
      const target = tables[d.tableIndex - 1];
      if (!target) {
        toast.error("Couldn't apply", `Table ${d.tableIndex} not found`);
        return;
      }
      setEdits((prev) => {
        const list = (prev[target.index] ?? target.cells ?? []).map((c) =>
          c.row === d.row && c.col === d.col ? { ...c, text: d.value } : c,
        );
        return { ...prev, [target.index]: list };
      });
      toast.success("Patch applied", `Table ${d.tableIndex} · row ${d.row + 1}, col ${d.col + 1}`);
    }
    window.addEventListener("tablex:applyPatch", onPatch);
    return () => window.removeEventListener("tablex:applyPatch", onPatch);
  }, [tables, toast]);

  const safeImg = Math.min(activeImg, Math.max(0, groups.length - 1));
  const group = groups[safeImg];
  const safeTable = Math.min(
    activeTable,
    Math.max(0, (group?.tables.length ?? 1) - 1),
  );
  const t = group?.tables[safeTable];

  useEffect(() => {
    setActiveTable(0);
  }, [safeImg]);

  if (!group || !t) {
    return (
      <div className="glass rounded-2xl p-8 text-center text-muted-2">
        No tables yet. Confirm a page to populate results.
      </div>
    );
  }

  const editedCells = edits[t.index] ?? t.cells ?? [];
  const tableCount = group.tables.length;

  function setCellText(rowIdx: number, colIdx: number, text: string) {
    setEdits((prev) => {
      const list = (prev[t.index] ?? t.cells ?? []).map((c) =>
        c.row === rowIdx && c.col === colIdx ? { ...c, text } : c,
      );
      return { ...prev, [t.index]: list };
    });
  }

  function downloadString(content: string, name: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadEditedCsv() {
    const csv = csvFromCells(editedCells, t.csv);
    downloadString(csv, `table_${t.index}.csv`, "text/csv");
    toast.success("Download started", `Table ${t.index} · CSV`);
  }

  function downloadHtml() {
    const body = htmlFromCells(editedCells, t.html);
    const wrapped = `<!doctype html><html><head><meta charset="utf-8"><title>Table ${t.index}</title><style>table{border-collapse:collapse;font-family:sans-serif}th,td{border:1px solid #ccc;padding:4px 8px}th{background:#eee}</style></head><body>${body}</body></html>`;
    downloadString(wrapped, `table_${t.index}.html`, "text/html");
    toast.success("Download started", `Table ${t.index} · HTML`);
  }

  return (
    <div className="glass rounded-2xl p-6 gradient-border">
      <div className="flex items-center justify-center gap-3 mb-4 flex-wrap">
        <button
          onClick={() => setActiveImg((i) => Math.max(0, i - 1))}
          disabled={safeImg === 0}
          className="px-3 py-1.5 rounded-lg border border-cyan/30 bg-[rgba(0,212,255,0.06)] hover:bg-[rgba(0,212,255,0.14)] hover:border-cyan disabled:opacity-30 text-sm text-cyan"
        >
          ← Prev image
        </button>
        <span className="font-mono text-sm text-text text-center">
          Image {safeImg + 1} / {groups.length}
          <span className="ml-2 text-xs text-muted">
            (page {group.pageIndex + 1})
          </span>
        </span>
        <button
          onClick={() => setActiveImg((i) => Math.min(groups.length - 1, i + 1))}
          disabled={safeImg === groups.length - 1}
          className="px-3 py-1.5 rounded-lg border border-cyan/30 bg-[rgba(0,212,255,0.06)] hover:bg-[rgba(0,212,255,0.14)] hover:border-cyan disabled:opacity-30 text-sm text-cyan"
        >
          Next image →
        </button>
        <CsvDownloadMenu jobId={jobId} group={group} edits={edits} />
      </div>

      {tableCount > 1 && (
        <div className="flex items-center justify-center gap-2 mb-4">
          <button
            onClick={() => setActiveTable((i) => Math.max(0, i - 1))}
            disabled={safeTable === 0}
            className="px-3 py-1 rounded-md border border-purple-400/40 bg-purple-500/10 hover:bg-purple-500/20 disabled:opacity-30 text-xs text-purple-200 light:text-purple-700 font-mono"
          >
            ← Prev table
          </button>
          <span className="font-mono text-xs text-purple-200 light:text-purple-700 text-center">
            Table {safeTable + 1} / {tableCount}
          </span>
          <button
            onClick={() => setActiveTable((i) => Math.min(tableCount - 1, i + 1))}
            disabled={safeTable === tableCount - 1}
            className="px-3 py-1 rounded-md border border-purple-400/40 bg-purple-500/10 hover:bg-purple-500/20 disabled:opacity-30 text-xs text-purple-200 light:text-purple-700 font-mono"
          >
            Next table →
          </button>
        </div>
      )}

      <ConfidenceSummary table={t} />

      <div className="grid md:grid-cols-2 gap-5">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted mb-2 text-center">
            Cropped image
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={tableImageUrl(jobId, t.index)}
            alt={`Table ${t.index}`}
            className="rounded-lg border border-border max-h-[28rem] w-full object-contain bg-input"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2 gap-2">
            <p className="text-xs uppercase tracking-wider text-muted text-center flex-1">
              Recognized data
              <span className="ml-2 text-muted-2 normal-case">
                · click cells to edit · {t.cell_count} cells
              </span>
            </p>
            <label className="flex items-center gap-1.5 text-xs text-muted-2 font-mono cursor-pointer">
              <input
                type="checkbox"
                checked={showConfidence}
                onChange={(e) => setShowConfidence(e.target.checked)}
                className="accent-cyan"
              />
              Confidence
            </label>
          </div>
          {editedCells.length ? (
            <EditableTable
              cells={editedCells}
              onChange={setCellText}
              showConfidence={showConfidence}
            />
          ) : (
            <div
              className="rounded-lg border border-border bg-input p-3 max-h-[28rem] overflow-auto text-sm text-text [&_table]:w-full [&_th]:bg-overlay [&_th,&_td]:px-2 [&_th,&_td]:py-1 [&_th,&_td]:border [&_th,&_td]:border-border"
              dangerouslySetInnerHTML={{ __html: t.html }}
            />
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 mt-4 flex-wrap">
        <button
          onClick={downloadEditedCsv}
          className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-400/40 hover:bg-emerald-500/25 text-xs font-mono text-emerald-200 light:text-emerald-700"
          title="Download this table as CSV (with your edits)"
        >
          Download CSV
        </button>
        <button
          onClick={downloadHtml}
          className="px-3 py-1.5 rounded-lg bg-sky-500/15 border border-sky-400/40 hover:bg-sky-500/25 text-xs font-mono text-sky-200 light:text-sky-700"
          title="Download this table as a standalone HTML file"
        >
          Download HTML
        </button>
      </div>
    </div>
  );
}

function CsvDownloadMenu({
  jobId,
  group,
  edits,
}: {
  jobId: string;
  group: ImageGroup;
  edits: Record<number, CellData[]>;
}) {
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

  function downloadString(content: string, name: string) {
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  }

  function csvFor(tt: TableData): string {
    return csvFromCells(edits[tt.index] ?? tt.cells ?? [], tt.csv);
  }

  function downloadCombined() {
    const combined = group.tables
      .map((tt, i) => `# Table ${i + 1}\n${csvFor(tt)}`)
      .join("\n\n");
    downloadString(combined, `page_${group.pageIndex + 1}_combined.csv`);
  }

  if (single) {
    return (
      <button
        onClick={() =>
          downloadString(csvFor(group.tables[0]), `table_${group.tables[0].index}.csv`)
        }
        className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-400/40 hover:bg-emerald-500/25 text-xs font-mono text-emerald-200 light:text-emerald-700"
      >
        Download CSV
      </button>
    );
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-400/40 hover:bg-emerald-500/25 text-xs font-mono text-emerald-200 light:text-emerald-700"
      >
        Download CSV ▾
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-10 w-56 rounded-lg border border-border bg-surface-3 shadow-xl overflow-hidden">
          <button
            onClick={downloadCombined}
            className="block w-full text-left px-3 py-2 text-xs font-mono text-text hover:bg-overlay"
          >
            One combined CSV
            <div className="text-muted text-[10px] mt-0.5">
              all {group.tables.length} tables in one file (with edits)
            </div>
          </button>
          <a
            href={pageCsvZipUrl(jobId, group.pageIndex)}
            download
            onClick={() => setOpen(false)}
            className="block w-full text-left px-3 py-2 text-xs font-mono text-text hover:bg-overlay border-t border-border"
          >
            ZIP of CSVs
            <div className="text-muted text-[10px] mt-0.5">
              one file per table — server-side originals (no edits)
            </div>
          </a>
        </div>
      )}
    </div>
  );
}

function ConfidenceSummary({ table }: { table: TableData }) {
  // detection_score === 0 (or null) ⇒ user-drawn box; show a tag instead of
  // a misleading "Detection: 0%" badge.
  const userDrawn = !table.detection_score;
  const items = [
    { label: "Structure", value: table.tsr_confidence },
    { label: "OCR", value: table.ocr_confidence },
  ].filter((i) => typeof i.value === "number" && i.value !== null);

  if (
    !userDrawn &&
    typeof table.detection_score === "number" &&
    table.detection_score > 0
  ) {
    items.unshift({ label: "Detection", value: table.detection_score });
  }

  if (!userDrawn && items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
      {userDrawn && (
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-purple-400/40 bg-purple-500/10 text-xs font-mono text-purple-200 light:text-purple-700">
          User-drawn box
        </span>
      )}
      {items.map((it) => (
        <ConfidenceBadge
          key={it.label}
          label={it.label}
          value={it.value as number}
        />
      ))}
    </div>
  );
}

function ConfidenceBadge({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.85
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 light:text-emerald-700"
      : value >= 0.6
        ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-300 light:text-yellow-700"
        : "border-red-500/40 bg-red-500/10 text-red-300 light:text-red-700";
  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-mono ${tone}`}
    >
      {label}
      <span className="font-bold">{pct}%</span>
    </span>
  );
}
