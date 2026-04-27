"use client";

import { useEffect, useRef, useState } from "react";
import { sendChat, type ChatMessage } from "@/lib/api";

interface Props {
  jobId?: string;
  attachedTableCount?: number;
}

export default function ChatWidget({ jobId, attachedTableCount = 0 }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
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
    try {
      const { reply } = await sendChat(next, jobId);
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed");
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 left-6 z-40 w-14 h-14 rounded-full bg-cyan text-black shadow-xl hover:scale-105 transition-transform flex items-center justify-center text-xl font-bold"
          aria-label="Open assistant"
        >
          💬
        </button>
      )}

      {open && (
        <div className="fixed bottom-6 left-6 z-40 w-[380px] max-w-[calc(100vw-3rem)] h-[560px] max-h-[calc(100vh-3rem)] glass rounded-2xl border border-border shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-3">
            <div>
              <div className="text-sm font-bold text-text">Assistant</div>
              {jobId && attachedTableCount > 0 && (
                <div className="text-[10px] font-mono text-muted-2 mt-0.5">
                  Attached: {attachedTableCount} table
                  {attachedTableCount === 1 ? "" : "s"} from current job
                </div>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-2 hover:text-text text-lg leading-none px-2"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-4 space-y-3 text-sm"
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
                {m.content}
              </Bubble>
            ))}
            {busy && (
              <Bubble role="assistant">
                <span className="opacity-60">Thinking…</span>
              </Bubble>
            )}
            {error && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
          </div>

          <div className="p-3 border-t border-border bg-surface-3">
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
              <button
                onClick={send}
                disabled={busy || !input.trim()}
                className="px-3 py-2 rounded-lg bg-cyan text-black text-xs font-bold disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
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
