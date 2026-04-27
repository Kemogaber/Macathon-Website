"use client";

import { useMemo } from "react";
import type { CellData } from "@/lib/api";

interface Props {
  cells: CellData[];
  onChange: (rowIdx: number, colIdx: number, text: string) => void;
  showConfidence: boolean;
}

interface PlacedCell extends CellData {
  display: boolean;
}

export default function EditableTable({ cells, onChange, showConfidence }: Props) {
  const { grid, rows, cols } = useMemo(() => buildGrid(cells), [cells]);

  if (rows === 0 || cols === 0) {
    return <p className="text-muted-2 text-sm">No cells to display.</p>;
  }

  return (
    <div className="overflow-auto rounded-lg border border-border bg-input max-h-[28rem]">
      <table className="w-full border-collapse text-sm text-text">
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => {
                const cell = grid[r][c];
                if (!cell || !cell.display) return null;
                const isHeader = r === 0;
                const Tag = isHeader ? "th" : "td";
                const conf = combinedConfidence(cell);
                const bg = showConfidence ? confidenceColor(conf) : "transparent";
                return (
                  <Tag
                    key={c}
                    rowSpan={cell.rowspan}
                    colSpan={cell.colspan}
                    className="border border-border align-top p-0 relative"
                    style={{ backgroundColor: bg }}
                  >
                    <input
                      value={cell.text}
                      onChange={(e) => onChange(cell.row, cell.col, e.target.value)}
                      className={`w-full bg-transparent px-2 py-1 outline-none focus:bg-cyan/10 ${
                        isHeader ? "font-semibold" : ""
                      }`}
                    />
                    {showConfidence && conf !== null && (
                      <span className="absolute top-0.5 right-1 text-[9px] font-mono text-text/50">
                        {Math.round(conf * 100)}
                      </span>
                    )}
                  </Tag>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildGrid(cells: CellData[]): {
  grid: (PlacedCell | null)[][];
  rows: number;
  cols: number;
} {
  if (!cells.length) return { grid: [], rows: 0, cols: 0 };
  const rows = Math.max(...cells.map((c) => c.row + (c.rowspan ?? 1)));
  const cols = Math.max(...cells.map((c) => c.col + (c.colspan ?? 1)));
  const grid: (PlacedCell | null)[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(null),
  );
  for (const c of cells) {
    const rs = c.rowspan ?? 1;
    const cs = c.colspan ?? 1;
    for (let dr = 0; dr < rs; dr++) {
      for (let dc = 0; dc < cs; dc++) {
        const rr = c.row + dr;
        const cc = c.col + dc;
        if (rr >= rows || cc >= cols) continue;
        grid[rr][cc] = { ...c, display: dr === 0 && dc === 0 };
      }
    }
  }
  return { grid, rows, cols };
}

function combinedConfidence(c: CellData): number | null {
  const parts = [c.tsr_score, c.ocr_score].filter(
    (v): v is number => typeof v === "number",
  );
  if (!parts.length) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

function confidenceColor(conf: number | null): string {
  if (conf === null) return "transparent";
  if (conf >= 0.85) return "rgba(16, 185, 129, 0.12)";
  if (conf >= 0.6) return "rgba(234, 179, 8, 0.18)";
  return "rgba(239, 68, 68, 0.22)";
}
