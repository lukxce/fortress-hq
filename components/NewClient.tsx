"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Candidate = {
  id: number; provider_id: string; display_name: string;
  domain: string | null; currency: string | null;
};

type Suggestion = {
  provider: "ga4" | "gsc" | "gtm";
  inventory_id: number;
  label: string;
  reason: string;
  confidence: "high" | "low";
};

const PROVIDER_LABEL = { ga4: "Analytics", gsc: "Search Console", gtm: "Tag Manager" } as const;

export function NewClient({ candidates }: { candidates: Candidate[] }) {
  const [adsId, setAdsId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [goalType, setGoalType] = useState<"cpa" | "roas">("cpa");
  const [target, setTarget] = useState("");
  const [budget, setBudget] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function pick(c: Candidate) {
    setAdsId(c.id);
    setName(c.display_name || `Account ${c.provider_id}`);
    setError(null);
    setSuggestions([]);
    try {
      const res = await fetch(`/api/clients?suggest=${c.id}`);
      const body = await res.json();
      const s: Suggestion[] = body.suggestions ?? [];
      setSuggestions(s);
      // Pre-tick only the confident matches. A low-confidence guess that binds
      // itself silently makes the conversion cross-check compare two unrelated
      // businesses, which is worse than leaving the slot empty.
      setAccepted(new Set(s.filter((x) => x.confidence === "high").map((x) => x.inventory_id)));
    } catch { /* suggestions are a convenience, not a requirement */ }
  }

  async function create() {
    if (!adsId || !name.trim()) { setError("Pick an account and give it a name."); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          adsInventoryId: adsId,
          goalType,
          targetCpa: goalType === "cpa" && target ? Number(target) : null,
          targetRoas: goalType === "roas" && target ? Number(target) : null,
          monthlyBudget: budget ? Number(budget) : null,
          bindings: suggestions
            .filter((s) => accepted.has(s.inventory_id))
            .map((s) => ({
              provider: s.provider,
              inventory_id: s.inventory_id,
              bound_by: s.confidence === "high" ? "auto" : "confirmed",
            })),
        }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error ?? "Could not create that client."); return; }
      router.push(`/clients/${body.id}` as never);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sheet sheet-pad">
      <h2 style={{ marginBottom: 4 }}>Add a project</h2>
      <p className="meta" style={{ marginBottom: 18 }}>
        {candidates.length} selected Ads account{candidates.length === 1 ? "" : "s"} not yet set up.
      </p>

      <div className="candidates">
        {candidates.map((c) => (
          <button
            key={c.id}
            className={`cand${adsId === c.id ? " picked" : ""}`}
            onClick={() => pick(c)}
            type="button"
          >
            <span className="cand-name">{c.display_name || c.provider_id}</span>
            <span className="meta mono">{c.provider_id}{c.domain ? ` · ${c.domain}` : ""}</span>
          </button>
        ))}
      </div>

      {adsId && (
        <div className="new-form">
          <div className="field">
            <label className="label" htmlFor="cname">Project name</label>
            <input id="cname" type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="field-row">
            <div className="field">
              <label className="label" htmlFor="goal">Judged on</label>
              <select id="goal" value={goalType} onChange={(e) => setGoalType(e.target.value as any)}>
                <option value="cpa">Cost per conversion</option>
                <option value="roas">Return on ad spend</option>
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="target">
                {goalType === "cpa" ? "Target cost per conversion" : "Target return"}
              </label>
              <input
                id="target" type="number" step="0.01" value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={goalType === "cpa" ? "e.g. 25" : "e.g. 4"}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="budget">Monthly budget</label>
              <input
                id="budget" type="number" step="1" value={budget}
                onChange={(e) => setBudget(e.target.value)} placeholder="optional"
              />
            </div>
          </div>

          <p className="meta field-note">
            Without a target there is nothing to judge performance against, so the
            dashboard will report figures without saying whether they are good.
          </p>

          {suggestions.length > 0 && (
            <div className="bindings">
              <span className="label">Also connect</span>
              {suggestions.map((s) => (
                <label key={s.inventory_id} className="binding">
                  <input
                    type="checkbox"
                    className="check"
                    checked={accepted.has(s.inventory_id)}
                    onChange={(e) => {
                      const next = new Set(accepted);
                      e.target.checked ? next.add(s.inventory_id) : next.delete(s.inventory_id);
                      setAccepted(next);
                    }}
                  />
                  <div className="grow">
                    <div className="row" style={{ gap: 8 }}>
                      <strong>{PROVIDER_LABEL[s.provider]}</strong>
                      <span className={`pill ${s.confidence === "high" ? "pill-good" : "pill-warn"}`}>
                        {s.confidence === "high" ? "matched" : "check this"}
                      </span>
                    </div>
                    <span className="meta">{s.label} — {s.reason}</span>
                  </div>
                </label>
              ))}
            </div>
          )}

          {error && <p className="err">{error}</p>}

          <button className="btn btn-accent" onClick={create} disabled={busy}>
            {busy && <span className="spinner" />}
            {busy ? "Creating…" : "Create project"}
          </button>
        </div>
      )}
    </section>
  );
}
