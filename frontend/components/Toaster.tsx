"use client";

import Link from "next/link";
import { useToast, type Toast } from "@/lib/toast";

const TONE: Record<Toast["kind"], string> = {
  success:
    "border-emerald-400/50 bg-emerald-500/15 text-emerald-200 light:text-emerald-800",
  error:
    "border-red-400/50 bg-red-500/15 text-red-200 light:text-red-800",
  info: "border-cyan/50 bg-cyan-dim text-cyan",
};

const ICON: Record<Toast["kind"], string> = {
  success: "✓",
  error: "⚠",
  info: "ℹ",
};

export default function Toaster() {
  const { toasts, dismiss } = useToast();
  if (!toasts.length) return null;
  return (
    <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none">
      {toasts.map((t) => {
        const inner = (
          <div
            className={`pointer-events-auto rounded-xl border backdrop-blur-md px-3 py-2.5 shadow-lg flex items-start gap-2 animate-[slideDown_220ms_ease-out] ${TONE[t.kind]}`}
          >
            <span className="text-base font-bold leading-tight mt-0.5">
              {ICON[t.kind]}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight">{t.title}</p>
              {t.detail && (
                <p className="text-xs opacity-80 mt-0.5 truncate">{t.detail}</p>
              )}
            </div>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dismiss(t.id);
              }}
              className="opacity-60 hover:opacity-100 text-sm leading-none px-1"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        );
        return t.href ? (
          <Link
            key={t.id}
            href={t.href}
            className="contents"
            onClick={() => dismiss(t.id)}
          >
            {inner}
          </Link>
        ) : (
          <div key={t.id}>{inner}</div>
        );
      })}
      <style>{`@keyframes slideDown {
        0% { transform: translateY(-12px); opacity: 0; }
        100% { transform: translateY(0); opacity: 1; }
      }`}</style>
    </div>
  );
}
