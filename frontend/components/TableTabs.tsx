"use client";

import { useEffect, useState } from "react";
import EditableTable from "@/components/EditableTable";
import { tableImageUrl, type CellData, type TableData } from "@/lib/api";

interface Props {
  jobId: string;
  tables: TableData[];
  forceCarousel?: boolean;
}

const TAB_LIMIT = 5;

export default function TableTabs({ jobId, tables, forceCarousel = false }: Props) {
  const [active, setActive] = useState(0);
  const [showConfidence, setShowConfidence] = useState(true);
  const [edits, setEdits] = useState<Record<number, CellData[]>>({});

  // Seed edits with the server cells whenever the tables list changes.
  useEffect(() => {
    setEdits((prev) => {
      const next = { ...prev };
      for (const t of tables) {
        if (!next[t.index] && t.cells) next[t.index] = t.cells.map((c) => ({ ...c }));
      }
      return next;
    });
  }, [tables]);

  if (tables.length === 0) {
    return (
      <div className="glass rounded-2xl p-8 text-center text-muted-2">
        No tables were extracted.
      </div>
    );
  }

  const useCarousel = forceCarousel || tables.length > TAB_LIMIT;
  const t = tables[active];
  const editedCells = edits[t.index] ?? t.cells ?? [];

  function setCellText(rowIdx: number, colIdx: number, text: string) {
    setEdits((prev) => {
      const list = (prev[t.index] ?? t.cells ?? []).map((c) =>
        c.row === rowIdx && c.col === colIdx ? { ...c, text } : c,
      );
      return { ...prev, [t.index]: list };
    });
  }

  function buildCsv(cells: CellData[]): string {
    if (!cells.length) return t.csv;
    const rows = Math.max(...cells.map((c) => c.row + (c.rowspan ?? 1)));
    const cols = Math.max(...cells.map((c) => c.col + (c.colspan ?? 1)));
    const grid: string[][] = Array.from({ length: rows }, () => Array(cols).fill(""));
    for (const c of cells) {
      if (c.row < rows && c.col < cols) grid[c.row][c.col] = c.text ?? "";
    }
    return grid
      .map((row) => row.map(escapeCsv).join(","))
      .join("\n");
  }

  function downloadCsv() {
    const csv = editedCells.length ? buildCsv(editedCells) : t.csv;
    const blob = new Blob([csv], { type: "text/csv" });
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
            className="px-3 py-1.5 rounded-lg border border-border hover:border-cyan/40 disabled:opacity-30 text-sm"
          >
            ← Prev
          </button>
          <span className="font-mono text-sm text-muted-2">
            Table {active + 1} / {tables.length}
          </span>
          <button
            onClick={() => setActive((i) => Math.min(tables.length - 1, i + 1))}
            disabled={active === tables.length - 1}
            className="px-3 py-1.5 rounded-lg border border-border hover:border-cyan/40 disabled:opacity-30 text-sm"
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
                  ? "border-cyan bg-[rgba(0,212,255,0.12)] text-cyan"
                  : "border-border text-muted-2 hover:border-overlay-strong"
              }`}
            >
              Table {tab.index}
            </button>
          ))}
        </div>
      )}

      {/* Confidence summary */}
      <ConfidenceSummary table={t} />

      {/* Crop preview */}
      <div className="grid md:grid-cols-2 gap-5 mb-5">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted mb-2">Cropped image</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={tableImageUrl(jobId, t.index)}
            alt={`Table ${t.index}`}
            className="rounded-lg border border-border max-h-72 object-contain bg-input"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-wider text-muted">
              Recognized data — click any cell to edit
            </p>
            <label className="flex items-center gap-2 text-xs text-muted-2 font-mono cursor-pointer">
              <input
                type="checkbox"
                checked={showConfidence}
                onChange={(e) => setShowConfidence(e.target.checked)}
                className="accent-cyan"
              />
              Confidence heatmap
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
              className="rounded-lg border border-border bg-input p-3 max-h-72 overflow-auto text-sm text-text [&_table]:w-full [&_th]:bg-overlay [&_th,&_td]:px-2 [&_th,&_td]:py-1 [&_th,&_td]:border [&_th,&_td]:border-border"
              dangerouslySetInnerHTML={{ __html: t.html }}
            />
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={downloadCsv}
          className="px-4 py-2 rounded-lg bg-cyan text-background font-bold text-sm hover:bg-cyan-300 transition-colors glow-cyan"
        >
          Download edited CSV
        </button>
        <a
          href={tableImageUrl(jobId, t.index)}
          download={`table_${t.index}.png`}
          className="px-4 py-2 rounded-lg bg-overlay border border-border hover:border-cyan/40 text-sm"
        >
          Download PNG
        </a>
        <span className="ml-auto text-xs text-muted self-center font-mono">
          {t.cell_count} cells
        </span>
      </div>
    </div>
  );
}

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function ConfidenceSummary({ table }: { table: TableData }) {
  const items = [
    { label: "Detection", value: table.detection_score },
    { label: "Structure", value: table.tsr_confidence },
    { label: "OCR", value: table.ocr_confidence },
  ].filter((i) => typeof i.value === "number" && i.value !== null);

  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      {items.map((it) => (
        <ConfidenceBadge key={it.label} label={it.label} value={it.value as number} />
      ))}
    </div>
  );
}

function ConfidenceBadge({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.85
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      : value >= 0.6
        ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-300"
        : "border-red-500/40 bg-red-500/10 text-red-300";
  return (
    <span
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-mono ${tone}`}
    >
      {label}
      <span className="font-bold">{pct}%</span>
    </span>
  );
}
