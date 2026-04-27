"use client";

import Link from "next/link";
import { useDemoStore } from "@/lib/demoStore";

const LABEL: Record<string, string> = {
  upload: "Uploading…",
  "detect-one": "Detecting…",
  "detect-all": "Detecting all…",
  "confirm-one": "Recognizing…",
  "confirm-all": "Recognizing all…",
};

export default function BusyIndicator() {
  const { busy, confirmProgress } = useDemoStore();
  if (!busy) return null;
  const showPct = busy === "confirm-one" || busy === "confirm-all";
  const label = LABEL[busy] ?? "Working…";
  return (
    <Link
      href="/demo"
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-cyan/30 bg-cyan-dim text-cyan text-xs font-mono hover:border-cyan transition-colors"
      title="Job in progress — click to return"
    >
      <span className="relative flex w-2 h-2">
        <span className="absolute inline-flex w-full h-full rounded-full bg-cyan opacity-60 animate-ping" />
        <span className="relative inline-flex w-2 h-2 rounded-full bg-cyan" />
      </span>
      {label}
      {showPct && (
        <span className="opacity-80">{Math.round(confirmProgress * 100)}%</span>
      )}
    </Link>
  );
}
