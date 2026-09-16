"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

type Msg = { role: "user" | "assistant"; content: string };

/**
 * Ask, on every client page. Read-only: it answers from one snapshot of the
 * account and points to the page that can change things.
 */
export function AskBubble() {
  const path = usePathname();
  const clientId = path.match(/^\/clients\/(\d+)/)?.[1] ?? null;
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  // A conversation belongs to one account.
  useEffect(() => { setLog([]); }, [clientId]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [log, busy]);

  if (!clientId) return null;

  async function send() {
    const question = text.trim();
    if (!question || busy) return;
    const history = log;
    setLog([...log, { role: "user", content: question }]);
    setText("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ client: Number(clientId), question, history }),
      });
      const b = await res.json();
      setLog((l) => [...l, { role: "assistant", content: res.ok ? b.answer : (b.message ?? b.error ?? "Something went wrong.") }]);
    } catch {
      setLog((l) => [...l, { role: "assistant", content: "Could not reach the server." }]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="ask-launch" onClick={() => setOpen(true)}>
        <span className="dot" aria-hidden />Ask about this account
      </button>
    );
  }

  return (
    <div className="ask-panel" role="dialog" aria-label="Ask about this account">
      <div className="ask-head">
        <div>
          <strong>Ask</strong>
          <div className="meta">Answers from this account&rsquo;s data. It cannot change anything.</div>
        </div>
        <button className="btn btn-quiet btn-sm" onClick={() => setOpen(false)} aria-label="Close">✕</button>
      </div>
      <div className="ask-log">
        {log.length === 0 && (
          <div className="meta">
            Try: &ldquo;Which keyword wasted the most money?&rdquo; · &ldquo;Why did cost per conversion rise?&rdquo; ·
            &ldquo;Is mobile worse than desktop?&rdquo;
          </div>
        )}
        {log.map((m, i) => <div key={i} className={`ask-msg ${m.role}`}>{m.content}</div>)}
        {busy && <div className="ask-msg assistant"><span className="spinner" /></div>}
        <div ref={end} />
      </div>
      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          value={text} rows={1} placeholder="Ask a question…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>Send</button>
      </form>
    </div>
  );
}
