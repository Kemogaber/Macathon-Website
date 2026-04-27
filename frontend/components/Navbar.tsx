"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import BusyIndicator from "@/components/BusyIndicator";

const links = [
  { href: "/", label: "Home" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/about", label: "About" },
  { href: "/dashboard", label: "Health" },
  { href: "/demo", label: "Parse" },
];

export default function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click and on route change.
  useEffect(() => {
    if (!mobileOpen) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [mobileOpen]);
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <nav className="max-w-6xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between gap-2">
        <Link href="/" className="flex items-center gap-2 group shrink-0">
          <span className="text-xl font-bold gradient-text">The Parsers</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-dim text-cyan border border-cyan/20 font-mono">
            AI
          </span>
        </Link>

        <ul className="hidden md:flex items-center gap-1">
          <li className="mr-2">
            <BusyIndicator />
          </li>
          <li className="mr-1">
            <ThemeToggle />
          </li>
          {links.map((link) => {
            const active = pathname === link.href;
            const isDemo = link.href === "/demo";
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={
                    isDemo
                      ? "ml-2 px-4 py-2 rounded-lg bg-cyan text-background font-semibold text-sm hover:bg-cyan-300 transition-colors"
                      : `px-4 py-2 rounded-lg text-sm transition-colors ${
                          active
                            ? "text-cyan bg-cyan-dim"
                            : "text-muted-2 hover:text-text hover:bg-overlay"
                        }`
                  }
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Mobile: hamburger dropdown */}
        <div className="flex md:hidden items-center gap-2" ref={wrapRef}>
          <BusyIndicator />
          <ThemeToggle />
          <button
            onClick={() => setMobileOpen((o) => !o)}
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            className="w-10 h-10 rounded-lg border border-border bg-surface-3 hover:bg-overlay flex items-center justify-center"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              {mobileOpen ? (
                <>
                  <path d="M6 6L18 18" />
                  <path d="M18 6L6 18" />
                </>
              ) : (
                <>
                  <path d="M4 7H20" />
                  <path d="M4 12H20" />
                  <path d="M4 17H20" />
                </>
              )}
            </svg>
          </button>
          {mobileOpen && (
            <div className="absolute right-4 top-14 w-56 rounded-xl border border-border bg-surface-3 shadow-2xl overflow-hidden">
              {links.map((link) => {
                const active = pathname === link.href;
                const isDemo = link.href === "/demo";
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`block px-4 py-3 text-sm border-b border-border last:border-b-0 transition-colors ${
                      isDemo
                        ? "bg-cyan/10 text-cyan font-semibold"
                        : active
                          ? "text-cyan bg-cyan-dim"
                          : "text-text hover:bg-overlay"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </nav>
    </header>
  );
}
