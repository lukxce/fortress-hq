"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Candidate = {
  id: number; provider_id: string; display_name: string;
  domain: string | null; currency: string | null;
};

type Suggestion = {
  provider: "ga4" | "gsc" | "gtm" | "gbp";
  inventory_id: number;
  label: string;
  reason: string;
  confidence: "high" | "low";
};

const PROVIDER_LABEL = { ga4: "Analytics", gsc: "Search Console", gtm: "Tag Manager", gbp: "Business Profile" } as const;

type Option = { id: number; provider: "ga4" | "gsc" | "gtm" | "gbp"; display_name: string; provider_id: string; domain: string | null };

export function NewClient({ candidates, options }: { candidates: Candidate[]; options: Option[] }) {
  const [adsId, setAdsId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [goalType, setGoalType] = useState<"cpa" | "roas">("cpa");
  const [target, setTarget] = useState("");
  const [budget, setBudget] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [chosen, setChosen] = useState<Record<"ga4" | "gsc" | "gtm" | "gbp", number | null>>({ ga4: null, gsc: null, gtm: null, gbp: null });
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
      const pre = { ga4: null, gsc: null, gtm: null, gbp: null } as Record<"ga4" | "gsc" | "gtm" | "gbp", number | null>;
      for (const x of s) if (x.confidence === "high") pre[x.provider] = x.inventory_id;
      setChosen(pre);
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
          bindings: (["ga4", "gsc", "gtm", "gbp"] as const)
            .filter((p) => chosen[p] != null)
            .map((p) => {
              const s = suggestions.find((x) => x.provider === p && x.inventory_id === chosen[p]);
              return { provider: p, inventory_id: chosen[p]!, bound_by: s?.confidence === "high" ? "auto" : s ? "confirmed" : "manual" };
            }),
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

          <div className="bindings">
            <span className="label">Also connect</span>
            {(["ga4", "gsc", "gtm", "gbp"] as const).map((p) => {
              const s = suggestions.find((x) => x.provider === p);
              const list = options.filter((o) => o.provider === p);
              return (
                <div key={p} className="binding" style={{ alignItems: "center" }}>
                  <div className="grow">
                    <div className="row" style={{ gap: 8 }}>
                      <strong>{PROVIDER_LABEL[p]}</strong>
                      {s && chosen[p] === s.inventory_id && (
                        <span className={`pill ${s.confidence === "high" ? "pill-good" : "pill-warn"}`}>{s.confidence === "high" ? "matched" : "check this"}</span>
                      )}
                    </div>
                    <span className="meta">
                      {s ? `Suggested: ${s.label} — ${s.reason}` : list.length ? "No match found. Pick one if it belongs to this business." : "Nothing reachable from your Google account."}
                    </span>
                  </div>
                  <select style={{ width: 300, maxWidth: "100%" }} value={chosen[p] ?? ""} disabled={!list.length} aria-label={PROVIDER_LABEL[p]}
                    onChange={(e) => setChosen({ ...chosen, [p]: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Not connected</option>
                    {list.map((o) => <option key={o.id} value={o.id}>{o.display_name || o.provider_id}{o.domain ? ` — ${o.domain}` : ""}</option>)}
                  </select>
                </div>
              );
            })}
          </div>

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
