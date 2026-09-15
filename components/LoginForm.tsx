"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// `next` arrives from a query string, so it is untrusted. Allow only known
// in-app destinations rather than redirecting anywhere the URL asks.
const DESTINATIONS = ["/overview", "/connect"] as const;
type Destination = (typeof DESTINATIONS)[number];

function safeNext(next: string): Destination {
  return (DESTINATIONS as readonly string[]).includes(next)
    ? (next as Destination)
    : "/overview";
}

export function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({})))?.error ?? "Sign-in failed.");
        setPassword("");
        return;
      }
      router.replace(safeNext(next));
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="sheet sheet-pad rise login" onSubmit={submit}>
      <span className="wordmark big">Fortress<span>hq</span></span>
      <p className="lede">Someone stands the watch.</p>

      <label className="label" htmlFor="pw">Password</label>
      <input
        id="pw"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus
        autoComplete="current-password"
      />

      {error && <p className="err">{error}</p>}

      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy && <span className="spinner" />}
        {busy ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}
