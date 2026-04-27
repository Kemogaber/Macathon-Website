"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import BusyIndicator from "@/components/BusyIndicator";

const links = [
  { href: "/", label: "Home" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/about", label: "About" },
  { href: "/dashboard", label: "Status" },
  { href: "/demo", label: "Parse" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <nav className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
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

        {/* Mobile menu — simplified */}
        <div className="flex md:hidden items-center gap-3">
          <ThemeToggle />
          {links.slice(-2).map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-muted-2 hover:text-text transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
