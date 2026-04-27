"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ---------------------------------------------------------------------------
// Schemas the model is taught to emit. We accept JSON we could parse — every
// other value falls back to a text block, so a malformed block can't crash
// the chat.
// ---------------------------------------------------------------------------

interface ChartSpec {
  type: "bar" | "line" | "pie" | "scatter";
  title?: string;
  x: string;
  y: string | string[];
  data: Record<string, unknown>[];
}

export interface PatchSpec {
  table_index: number;
  row: number;
  col: number;
  new_value: string;
  note?: string;
}

type Segment =
  | { kind: "text"; text: string }
  | { kind: "chart"; spec: ChartSpec | null; raw: string }
  | { kind: "patch"; spec: PatchSpec | null; raw: string };

const FENCE_RE = /```(chart|patch)\s*\n([\s\S]*?)```/g;

export function parseSegments(content: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of content.matchAll(FENCE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: "text", text: content.slice(last, idx) });
    const tag = m[1] as "chart" | "patch";
    const raw = m[2].trim();
    let spec: ChartSpec | PatchSpec | null = null;
    try {
      spec = JSON.parse(raw);
    } catch {
      spec = null;
    }
    if (tag === "chart") {
      out.push({ kind: "chart", spec: spec as ChartSpec | null, raw });
    } else {
      out.push({ kind: "patch", spec: spec as PatchSpec | null, raw });
    }
    last = idx + m[0].length;
  }
  if (last < content.length) out.push({ kind: "text", text: content.slice(last) });
  return out;
}

// ---------------------------------------------------------------------------
// Chart renderer
// ---------------------------------------------------------------------------
const PALETTE = ["#00d4ff", "#7c3aed", "#10b981", "#f59e0b", "#ef4444", "#3b82f6"];

function coerceNumber(v: unknown): number | unknown {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return v;
  // Strip thousands separators, %, currency symbols, surrounding whitespace.
  const cleaned = v.replace(/[,\s$£€¥%]/g, "");
  if (cleaned === "" || cleaned === "-") return v;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : v;
}

export function ChartBlock({ spec }: { spec: ChartSpec | null }) {
  if (!spec || !spec.data || !Array.isArray(spec.data) || spec.data.length === 0) {
    return <BadBlock label="chart" />;
  }
  const ys = Array.isArray(spec.y) ? spec.y : [spec.y];
  // Recharts silently drops non-numeric y values (pie wedges vanish, bars show
  // empty). Coerce strings like "1,234", "50%", "$12" before passing in.
  const cleanData = spec.data.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const k of ys) out[k] = coerceNumber(row[k]);
    return out;
  });
  // Pie needs at least one positive numeric slice or it renders empty.
  if (spec.type === "pie") {
    const k = ys[0];
    const hasNumeric = cleanData.some(
      (r) => typeof r[k] === "number" && (r[k] as number) > 0,
    );
    if (!hasNumeric) return <BadBlock label="chart" />;
  }
  const cleanSpec = { ...spec, data: cleanData };

  return (
    <div className="my-2 rounded-lg border border-border bg-input p-2">
      {spec.title && (
        <div className="text-xs font-mono text-muted-2 mb-1 px-1">{spec.title}</div>
      )}
      <div className="w-full h-56">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart(cleanSpec.type, cleanSpec, ys) as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function renderChart(
  type: ChartSpec["type"],
  spec: ChartSpec,
  ys: string[],
): React.ReactElement {
  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
      <XAxis dataKey={spec.x} tick={{ fontSize: 10 }} />
      <YAxis tick={{ fontSize: 10 }} />
      <Tooltip
        contentStyle={{
          background: "#0a0b0f",
          border: "1px solid rgba(255,255,255,0.15)",
          fontSize: 11,
        }}
      />
      {ys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
    </>
  );

  switch (type) {
    case "bar":
      return (
        <BarChart data={spec.data}>
          {common}
          {ys.map((k, i) => (
            <Bar key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </BarChart>
      );
    case "line":
      return (
        <LineChart data={spec.data}>
          {common}
          {ys.map((k, i) => (
            <Line
              key={k}
              type="monotone"
              dataKey={k}
              stroke={PALETTE[i % PALETTE.length]}
              dot={{ r: 3 }}
            />
          ))}
        </LineChart>
      );
    case "scatter":
      return (
        <ScatterChart data={spec.data}>
          {common}
          {ys.map((k, i) => (
            <Scatter key={k} dataKey={k} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </ScatterChart>
      );
    case "pie":
      return (
        <PieChart>
          <Tooltip
            contentStyle={{
              background: "#0a0b0f",
              border: "1px solid rgba(255,255,255,0.15)",
              fontSize: 11,
            }}
          />
          <Pie
            data={spec.data}
            dataKey={ys[0]}
            nameKey={spec.x}
            cx="50%"
            cy="50%"
            outerRadius={70}
            label={{ fontSize: 10 }}
          >
            {spec.data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      );
  }
}

// ---------------------------------------------------------------------------
// Patch renderer — Apply dispatches a CustomEvent that ImageResults handles.
// ---------------------------------------------------------------------------

export const PATCH_EVENT = "tablex:applyPatch";

export interface PatchEventDetail {
  tableIndex: number; // matches TableResult.index (1-based as shown to LLM)
  row: number;
  col: number;
  value: string;
}

export function PatchBlock({ spec }: { spec: PatchSpec | null }) {
  const [state, setState] = useState<"pending" | "applied" | "rejected">(
    "pending",
  );

  if (!spec) return <BadBlock label="patch" />;

  function apply() {
    if (!spec) return;
    const detail: PatchEventDetail = {
      tableIndex: spec.table_index,
      row: spec.row,
      col: spec.col,
      value: spec.new_value,
    };
    window.dispatchEvent(new CustomEvent(PATCH_EVENT, { detail }));
    setState("applied");
  }

  return (
    <div className="my-2 rounded-lg border border-amber-400/40 bg-amber-500/10 p-2 text-xs">
      <div className="font-mono text-amber-200 light:text-amber-700">
        Suggested fix · Table {spec.table_index} · row {spec.row + 1}, col {spec.col + 1}
      </div>
      <div className="mt-1 font-mono text-text break-words">
        → <span className="bg-amber-400/20 px-1 rounded">{spec.new_value}</span>
      </div>
      {spec.note && <div className="mt-1 text-muted-2 italic">{spec.note}</div>}
      {state === "pending" && (
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={apply}
            className="px-2.5 py-1 rounded-md bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 light:text-emerald-700 hover:bg-emerald-500/30 font-bold"
          >
            Apply
          </button>
          <button
            onClick={() => setState("rejected")}
            className="px-2.5 py-1 rounded-md border border-border text-muted-2 hover:text-text hover:bg-overlay"
          >
            Reject
          </button>
        </div>
      )}
      {state === "applied" && (
        <div className="mt-2 text-emerald-300 light:text-emerald-700 font-mono">
          ✓ Applied
        </div>
      )}
      {state === "rejected" && (
        <div className="mt-2 text-muted-2 font-mono">Rejected</div>
      )}
    </div>
  );
}

function BadBlock({ label }: { label: string }) {
  return (
    <div className="my-2 rounded-md border border-red-400/40 bg-red-500/10 px-2 py-1 text-[10px] font-mono text-red-300">
      Could not parse {label} block.
    </div>
  );
}
