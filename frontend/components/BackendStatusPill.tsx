"use client";

import { useEffect, useState } from "react";
import { checkHealth, type HealthInfo } from "@/lib/api";

const POLL_MS = 10_000;

export default function BackendStatusPill() {
  const [info, setInfo] = useState<HealthInfo | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const h = await checkHealth();
        if (cancelled) return;
        setInfo(h);
        setReachable(true);
      } catch {
        if (cancelled) return;
        setReachable(false);
      }
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const dotColor =
    reachable === false
      ? "bg-red-500"
      : info && (info.cpu_percent ?? 0) > 85
        ? "bg-amber-400"
        : "bg-emerald-400";

  const label =
    reachable === false
      ? "offline"
      : info
        ? `CPU ${fmtPct(info.cpu_percent)} · RAM ${fmtPct(info.ram_percent)}`
        : "connecting…";

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-surface-3 hover:bg-overlay text-xs font-mono text-text"
      >
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        {label}
      </button>
      {open && info && reachable && (
        <div
          className="absolute right-0 mt-1 z-20 w-64 rounded-lg border border-border bg-surface-3 shadow-xl p-3 text-xs font-mono text-text"
          onMouseLeave={() => setOpen(false)}
        >
          <Row label="Status" value={info.status} />
          <Row label="Uptime" value={fmtUptime(info.uptime_s)} />
          <Row label="Active jobs" value={String(info.active_jobs ?? 0)} />
          <div className="my-2 border-t border-border" />
          <Row label="CPU" value={fmtPct(info.cpu_percent)} />
          <Row
            label="RAM"
            value={
              info.ram_used_mb != null && info.ram_total_mb != null
                ? `${info.ram_used_mb} / ${info.ram_total_mb} MB (${fmtPct(info.ram_percent)})`
                : fmtPct(info.ram_percent)
            }
          />
          {info.process_rss_mb != null && (
            <Row label="Process RSS" value={`${info.process_rss_mb} MB`} />
          )}
          {info.model && (
            <>
              <div className="my-2 border-t border-border" />
              <div className="text-muted-2 text-[10px] leading-snug">
                {info.model}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-muted-2">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function fmtPct(n: number | undefined): string {
  return typeof n === "number" ? `${n.toFixed(0)}%` : "–";
}

function fmtUptime(s: number | undefined): string {
  if (typeof s !== "number") return "–";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
