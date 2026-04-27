"use client";

import { useEffect, useState } from "react";
import { checkHealth, getMetrics, type MetricsData } from "@/lib/api";

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const [m, h] = await Promise.all([
          getMetrics(),
          checkHealth().then(() => true).catch(() => false),
        ]);
        if (cancelled) return;
        setMetrics(m);
        setHealthy(h);
        setError("");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load metrics");
        setHealthy(false);
      }
    }
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <span className="inline-block px-3 py-1 rounded-full border border-[#00d4ff]/20 bg-[rgba(0,212,255,0.1)] text-[#00d4ff] text-xs font-mono mb-3">
            Health Dashboard
          </span>
          <h1 className="text-4xl font-black text-white">System Status</h1>
        </div>
        <StatusPill healthy={healthy} />
      </div>

      {error && (
        <div className="glass rounded-2xl p-4 border border-red-500/30 bg-red-500/5 mb-6">
          <p className="text-red-400 text-sm">⚠ {error}</p>
        </div>
      )}

      {metrics ? (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Stat
              label="Success rate"
              value={`${(metrics.success_rate * 100).toFixed(1)}%`}
              tone={metrics.success_rate >= 0.95 ? "good" : metrics.success_rate >= 0.8 ? "warn" : "bad"}
            />
            <Stat label="Active jobs" value={String(metrics.active_jobs)} />
            <Stat label="Jobs created" value={String(metrics.jobs_created)} />
            <Stat label="Uptime" value={formatUptime(metrics.uptime_s)} />
          </div>

          <div className="grid sm:grid-cols-3 gap-4 mb-6">
            <Stat label="Latency p50" value={formatMs(metrics.latency_ms.p50)} />
            <Stat label="Latency p95" value={formatMs(metrics.latency_ms.p95)} />
            <Stat label="Latency avg" value={formatMs(metrics.latency_ms.avg)} />
          </div>

          <div className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-white">Recent jobs</h2>
              <span className="text-xs text-[#6b7280] font-mono">
                {metrics.jobs_succeeded} ✓ · {metrics.jobs_failed} ✗
              </span>
            </div>
            <div className="overflow-auto max-h-[28rem] rounded-lg border border-white/10">
              <table className="w-full text-sm text-white">
                <thead className="bg-white/5 sticky top-0">
                  <tr className="text-left text-[#9ca3af] text-xs uppercase tracking-wider">
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Job</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Duration</th>
                    <th className="px-3 py-2">Tables</th>
                    <th className="px-3 py-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.recent.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-[#6b7280] text-sm">
                        No jobs yet.
                      </td>
                    </tr>
                  ) : (
                    [...metrics.recent].reverse().map((r, i) => (
                      <tr key={`${r.job_id}-${i}`} className="border-t border-white/5">
                        <td className="px-3 py-2 font-mono text-xs text-[#9ca3af]">
                          {new Date(r.ts * 1000).toLocaleTimeString()}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{r.job_id.slice(0, 8)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-mono ${
                              r.status === "done"
                                ? "bg-emerald-500/15 text-emerald-300"
                                : "bg-red-500/15 text-red-300"
                            }`}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{formatMs(r.duration_ms)}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.table_count}</td>
                        <td className="px-3 py-2 text-xs text-red-300 truncate max-w-xs">
                          {r.error ?? ""}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : !error ? (
        <div className="glass rounded-2xl p-8 text-center text-[#9ca3af]">Loading…</div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad";
}) {
  const accent =
    tone === "good"
      ? "text-emerald-300"
      : tone === "warn"
        ? "text-yellow-300"
        : tone === "bad"
          ? "text-red-300"
          : "text-white";
  return (
    <div className="glass rounded-2xl p-5">
      <p className="text-xs uppercase tracking-wider text-[#6b7280] font-mono mb-1">{label}</p>
      <p className={`text-2xl font-black ${accent}`}>{value}</p>
    </div>
  );
}

function StatusPill({ healthy }: { healthy: boolean | null }) {
  if (healthy === null) {
    return (
      <span className="px-3 py-1.5 rounded-full border border-white/10 text-xs font-mono text-[#9ca3af]">
        Checking…
      </span>
    );
  }
  return healthy ? (
    <span className="px-3 py-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-xs font-mono">
      ● Healthy
    </span>
  ) : (
    <span className="px-3 py-1.5 rounded-full border border-red-500/40 bg-red-500/10 text-red-300 text-xs font-mono">
      ● Down
    </span>
  );
}

function formatMs(ms: number): string {
  if (!ms) return "–";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatUptime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}
