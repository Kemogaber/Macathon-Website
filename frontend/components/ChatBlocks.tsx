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

export interface RecommendSite {
  name: string;
  url: string;
  why?: string;
}

export interface RecommendSpec {
  genre: string;
  reasoning?: string;
  sites: RecommendSite[];
}

type Segment =
  | { kind: "text"; text: string }
  | { kind: "chart"; spec: ChartSpec | null; raw: string }
  | { kind: "patch"; spec: PatchSpec | null; raw: string }
  | { kind: "recommend"; spec: RecommendSpec | null; raw: string };

const FENCE_RE = /```(chart|patch|recommend)\s*\n([\s\S]*?)```/g;

export function parseSegments(content: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of content.matchAll(FENCE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ kind: "text", text: content.slice(last, idx) });
    const tag = m[1] as "chart" | "patch" | "recommend";
    const raw = m[2].trim();
    let spec: ChartSpec | PatchSpec | RecommendSpec | null = null;
    try {
      spec = JSON.parse(raw);
    } catch {
      spec = null;
    }
    if (tag === "chart") {
      out.push({ kind: "chart", spec: spec as ChartSpec | null, raw });
    } else if (tag === "patch") {
      out.push({ kind: "patch", spec: spec as PatchSpec | null, raw });
    } else {
      out.push({ kind: "recommend", spec: spec as RecommendSpec | null, raw });
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

// ---------------------------------------------------------------------------
// Recommend renderer — site cards based on inferred table genre.
// ---------------------------------------------------------------------------

function isHttpUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function RecommendBlock({ spec }: { spec: RecommendSpec | null }) {
  if (!spec || !Array.isArray(spec.sites) || spec.sites.length === 0) {
    return <BadBlock label="recommend" />;
  }
  const sites = spec.sites.filter((s) => s && s.name && isHttpUrl(s.url)).slice(0, 4);
  if (sites.length === 0) return <BadBlock label="recommend" />;

  return (
    <div className="my-2 rounded-lg border border-cyan/30 bg-[rgba(0,212,255,0.06)] p-2.5 text-xs">
      <div className="flex items-center gap-2 font-mono text-cyan">
        <span>★ Recommended for</span>
        <span className="px-1.5 py-0.5 rounded-md bg-cyan/15 border border-cyan/30 lowercase">
          {spec.genre || "tables"}
        </span>
      </div>
      {spec.reasoning && (
        <div className="mt-1 text-muted-2 italic leading-snug">{spec.reasoning}</div>
      )}
      <div className="mt-2 flex flex-col gap-1.5">
        {sites.map((s, i) => (
          <a
            key={i}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded-md border border-border bg-overlay/60 hover:border-cyan/40 hover:bg-overlay px-2 py-1.5 transition-colors"
          >
            <div className="font-bold text-text">{s.name} ↗</div>
            {s.why && <div className="text-muted-2 mt-0.5">{s.why}</div>}
          </a>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny markdown renderer for assistant text — we don't need the full spec,
// just bullets / numbered lists / **bold** / *italic* / `code` / [link](url)
// and paragraph breaks. Anything else falls through as plain text.
// ---------------------------------------------------------------------------

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Order matters: code first (its content is opaque), then links, then
  // bold (** before *), then italic.
  const re = /(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\s]+\))|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(
        <code
          key={`${keyBase}-c${i}`}
          className="px-1 py-0.5 rounded bg-overlay border border-border font-mono text-[11px]"
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("[")) {
      const close = tok.indexOf("](");
      const label = tok.slice(1, close);
      const url = tok.slice(close + 2, -1);
      const safe = /^https?:\/\//i.test(url) ? url : "#";
      out.push(
        <a
          key={`${keyBase}-l${i}`}
          href={safe}
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan underline decoration-cyan/40 hover:decoration-cyan"
        >
          {label}
        </a>,
      );
    } else if (tok.startsWith("**")) {
      out.push(
        <strong key={`${keyBase}-b${i}`} className="font-bold text-text">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      out.push(
        <em key={`${keyBase}-i${i}`} className="italic">
          {tok.slice(1, -1)}
        </em>,
      );
    }
    last = idx + tok.length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface MdBlock {
  kind: "p" | "ul" | "ol";
  items: string[]; // for p: single item; for lists: each li
}

function parseBlocks(text: string): MdBlock[] {
  const lines = text.split("\n");
  const out: MdBlock[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      out.push({ kind: "p", items: [para.join("\n")] });
      para = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    const bullet = /^\s*[-*]\s+(.*)$/.exec(ln);
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(ln);
    if (bullet || numbered) {
      flushPara();
      const kind: "ul" | "ol" = bullet ? "ul" : "ol";
      const items: string[] = [];
      while (i < lines.length) {
        const m = kind === "ul"
          ? /^\s*[-*]\s+(.*)$/.exec(lines[i])
          : /^\s*\d+\.\s+(.*)$/.exec(lines[i]);
        if (!m) break;
        items.push(m[1]);
        i++;
      }
      out.push({ kind, items });
      continue;
    }
    if (ln.trim() === "") {
      flushPara();
    } else {
      para.push(ln);
    }
    i++;
  }
  flushPara();
  return out;
}

export function MarkdownText({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  if (blocks.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {blocks.map((b, bi) => {
        if (b.kind === "p") {
          return (
            <p key={bi} className="whitespace-pre-wrap break-words leading-snug">
              {renderInline(b.items[0], `p${bi}`)}
            </p>
          );
        }
        const ListTag = b.kind === "ul" ? "ul" : "ol";
        const listClass =
          b.kind === "ul"
            ? "list-disc list-inside space-y-0.5 pl-1"
            : "list-decimal list-inside space-y-0.5 pl-1";
        return (
          <ListTag key={bi} className={listClass}>
            {b.items.map((it, ii) => (
              <li key={ii} className="leading-snug">
                {renderInline(it, `b${bi}i${ii}`)}
              </li>
            ))}
          </ListTag>
        );
      })}
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
