"use client";

import { useEffect, useRef, useState } from "react";
import { streamChat, type ChatMessage } from "@/lib/api";
import {
  ChartBlock,
  MarkdownText,
  PatchBlock,
  RecommendBlock,
  parseSegments,
} from "@/components/ChatBlocks";

interface Props {
  jobId?: string;
  attachedTableCount?: number;
  /** Show a one-time speech bubble next to the closed icon. Hides on click,
   *  on dismiss, or once the user opens the chat. */
  nudge?: string | null;
}

const STORAGE_KEY = "tablex.chat.v1";

function loadMessages(): ChatMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is ChatMessage =>
        m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
    );
  } catch {
    return [];
  }
}

function saveMessages(msgs: ChatMessage[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
  } catch {
    /* quota exceeded — ignore */
  }
}

export default function ChatWidget({
  jobId,
  attachedTableCount = 0,
  nudge = null,
}: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  const showNudge = !!nudge && !open && !nudgeDismissed;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Icon position is the anchor for everything — panel hangs off it. Tracked
  // as `right`/`bottom` offsets from the viewport so resizing the window
  // keeps the icon visible.
  const ICON_SIZE = 56;
  const [iconPos, setIconPos] = useState<{ right: number; bottom: number }>({
    right: 24,
    bottom: 24,
  });

  // Drag-vs-click: pointerdown starts a tracker; if the pointer moves past
  // ~5px we treat it as a drag and suppress the toggle on pointerup.
  function onIconPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    const start = {
      x: e.clientX,
      y: e.clientY,
      right: iconPos.right,
      bottom: iconPos.bottom,
    };
    let dragged = false;
    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!dragged && Math.hypot(dx, dy) < 5) return;
      dragged = true;
      const right = Math.max(
        8,
        Math.min(window.innerWidth - ICON_SIZE - 8, start.right - dx),
      );
      const bottom = Math.max(
        8,
        Math.min(window.innerHeight - ICON_SIZE - 8, start.bottom - dy),
      );
      setIconPos({ right, bottom });
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!dragged) {
        setNudgeDismissed(true);
        setOpen((o) => !o);
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Load persisted messages once on mount.
  useEffect(() => {
    setMessages(loadMessages());
  }, []);

  // Persist on every change.
  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  // Auto-scroll only when the user is already near the bottom — don't yank
  // them down if they scrolled up to read previous messages.
  const stickyBottomRef = useRef(true);
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickyBottomRef.current = distanceFromBottom < 60;
  }
  useEffect(() => {
    if (!open) return;
    if (!stickyBottomRef.current) return;
    scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
  }, [messages, open, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setError(null);
    setBusy(true);

    // Append a placeholder assistant message that we mutate as deltas arrive.
    const withAssistant: ChatMessage[] = [...next, { role: "assistant", content: "" }];
    setMessages(withAssistant);
    const assistantIdx = withAssistant.length - 1;

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      let acc = "";
      await streamChat(
        next,
        jobId,
        (delta) => {
          acc += delta;
          setMessages((prev) => {
            const copy = [...prev];
            copy[assistantIdx] = { role: "assistant", content: acc };
            return copy;
          });
        },
        ctrl.signal,
      );
    } catch (e) {
      // If the user aborted, keep whatever was streamed so far; otherwise show error.
      if ((e as Error).name === "AbortError") {
        // leave messages as-is
      } else {
        setError(e instanceof Error ? e.message : "Chat failed");
        // Drop the empty assistant placeholder if nothing was streamed.
        setMessages((prev) => {
          if (prev[assistantIdx]?.content === "") return prev.slice(0, -1);
          return prev;
        });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function clearChat() {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      {showNudge && (
        <div
          style={{
            right: iconPos.right,
            bottom: iconPos.bottom + ICON_SIZE + 12,
          }}
          className="fixed z-40 max-w-[260px] rounded-xl bg-background border border-cyan/40 shadow-2xl p-3 animate-in fade-in slide-in-from-bottom-2"
        >
          <div className="flex items-start gap-2">
            <div className="flex-1 text-xs text-text leading-snug">{nudge}</div>
            <button
              onClick={() => setNudgeDismissed(true)}
              aria-label="Dismiss"
              className="text-muted-2 hover:text-text leading-none px-1"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {open && (
        <div
          style={
            typeof window !== "undefined" && window.innerWidth < 640
              ? {
                  left: 8,
                  right: 8,
                  bottom: iconPos.bottom + ICON_SIZE + 8,
                  height: `calc(100vh - ${iconPos.bottom + ICON_SIZE + 24}px)`,
                  maxHeight: `calc(100vh - ${iconPos.bottom + ICON_SIZE + 24}px)`,
                }
              : {
                  // Anchor panel's bottom-right to icon's top-left (with a small gap).
                  right: iconPos.right + ICON_SIZE + 8,
                  bottom: iconPos.bottom + ICON_SIZE + 8,
                  width: 380,
                  height: 560,
                  maxWidth: `calc(100vw - ${iconPos.right + ICON_SIZE + 24}px)`,
                  maxHeight: `calc(100vh - ${iconPos.bottom + ICON_SIZE + 24}px)`,
                }
          }
          className="fixed z-40 bg-background rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-3">
            <div className="min-w-0">
              <div className="text-sm font-bold text-text">Assistant</div>
              {jobId && attachedTableCount > 0 && (
                <div className="text-[10px] font-mono text-muted-2 mt-0.5 truncate">
                  Attached: {attachedTableCount} table
                  {attachedTableCount === 1 ? "" : "s"} from current job
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={clearChat}
                disabled={messages.length === 0 && !busy}
                className="text-xs font-mono px-2.5 py-1 rounded-md border border-border text-muted-2 hover:text-text hover:bg-overlay hover:border-cyan/40 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Clear conversation"
              >
                Clear
              </button>
            </div>
          </div>

          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-3 text-sm"
          >
            {messages.length === 0 && (
              <div className="text-muted-2 text-xs leading-relaxed">
                Ask about your extracted tables, OCR fixes, or how the demo
                works. I can see the tables on this job.
                <ul className="mt-3 space-y-1 list-disc list-inside text-muted">
                  <li>What does Table 1 say about totals?</li>
                  <li>Spot likely OCR mistakes.</li>
                  <li>How do I download as XLSX?</li>
                </ul>
              </div>
            )}
            {messages.map((m, i) => (
              <Bubble key={i} role={m.role}>
                {m.role === "assistant" ? (
                  m.content ? (
                    <AssistantContent content={m.content} />
                  ) : busy && i === messages.length - 1 ? (
                    <span className="opacity-60">…</span>
                  ) : (
                    ""
                  )
                ) : (
                  m.content
                )}
              </Bubble>
            ))}
            {error && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
          </div>

          <div className="p-3 border-t border-border bg-surface-3 space-y-2">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                placeholder="Ask anything about your tables…"
                rows={2}
                disabled={busy}
                className="flex-1 resize-none rounded-lg border border-border bg-input px-3 py-2 text-xs font-mono text-text placeholder:text-muted-2 outline-none focus:border-cyan/50 disabled:opacity-50"
              />
              {busy ? (
                <button
                  onClick={stop}
                  className="px-3 py-2 rounded-lg bg-red-500/15 border border-red-400/40 hover:bg-red-500/25 text-red-200 light:text-red-700 text-xs font-bold"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={send}
                  disabled={!input.trim()}
                  className="px-3 py-2 rounded-lg bg-cyan text-black text-xs font-bold disabled:opacity-40"
                >
                  Send
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <button
        onPointerDown={onIconPointerDown}
        style={{ right: iconPos.right, bottom: iconPos.bottom }}
        className="fixed z-50 w-14 h-14 rounded-full bg-cyan text-black shadow-xl hover:scale-105 transition-transform flex items-center justify-center text-2xl font-bold cursor-grab active:cursor-grabbing select-none touch-none"
        aria-label={open ? "Close assistant" : "Open assistant"}
        title="Click to toggle · drag to move"
      >
        {open ? "×" : "💬"}
      </button>
    </>
  );
}

function AssistantContent({ content }: { content: string }) {
  const segments = parseSegments(content);
  return (
    <>
      {segments.map((s, i) => {
        if (s.kind === "text") {
          return <MarkdownText key={i} text={s.text} />;
        }
        if (s.kind === "chart") {
          return <ChartBlock key={i} spec={s.spec} />;
        }
        if (s.kind === "recommend") {
          return <RecommendBlock key={i} spec={s.spec} />;
        }
        return <PatchBlock key={i} spec={s.spec} />;
      })}
    </>
  );
}

function Bubble({
  role,
  children,
}: {
  role: "user" | "assistant";
  children: React.ReactNode;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs whitespace-pre-wrap break-words ${
          isUser
            ? "bg-cyan text-black"
            : "bg-overlay text-text border border-border"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
