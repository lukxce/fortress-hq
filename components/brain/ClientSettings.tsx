"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ClientSettings({ clientId, brandTerms, derived, website, targetCpa, monthlyBudget, currency }: {
  clientId: number; brandTerms: string[]; derived: string[]; website: string | null;
  targetCpa: number | null; monthlyBudget: number | null; currency: string | null;
}) {
  const router = useRouter();
  const [brands, setBrands] = useState((brandTerms.length ? brandTerms : derived).join(", "));
  const [site, setSite] = useState(website ?? "");
  const [cpa, setCpa] = useState(targetCpa?.toString() ?? "");
  const [budget, setBudget] = useState(monthlyBudget?.toString() ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");

  async function save() {
    setState("saving");
    const res = await fetch("/api/clients/settings", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client: clientId,
        brandTerms: brands.split(",").map((b) => b.trim()).filter(Boolean),
        website: site.trim() || null,
        targetCpa: cpa ? Number(cpa) : null,
        monthlyBudget: budget ? Number(budget) : null,
      }),
    });
    const b = await res.json().catch(() => ({}));
    setState(res.ok ? "saved" : b.error ?? "Could not save.");
    if (res.ok) router.refresh();
  }

  return (
    <div className="stack-sm">
      <div className="field">
        <label className="label" htmlFor="brands">Brand words</label>
        <input id="brands" type="text" value={brands} onChange={(e) => setBrands(e.target.value)} placeholder="optimal25, …" />
        <p className="field-note">
          Searches containing these are never treated as waste and never proposed as negatives.
          {brandTerms.length ? "" : " These were worked out from the account name and domain — correct them if they are wrong."}
          {" "}Trade and city words like &ldquo;klima&rdquo; or &ldquo;niš&rdquo; are not brands.
        </p>
      </div>
      <div className="field-row">
        <div className="field">
          <label className="label" htmlFor="site">Website</label>
          <input id="site" type="url" value={site} onChange={(e) => setSite(e.target.value)} placeholder="https://" />
        </div>
        <div className="field">
          <label className="label" htmlFor="cpa">Target cost per lead ({currency ?? ""})</label>
          <input id="cpa" type="number" value={cpa} onChange={(e) => setCpa(e.target.value)} placeholder="optional" />
        </div>
        <div className="field">
          <label className="label" htmlFor="budget">Monthly budget ({currency ?? ""})</label>
          <input id="budget" type="number" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="optional" />
        </div>
      </div>
      <div className="row">
        <button className="btn btn-primary" onClick={save} disabled={state === "saving"}>{state === "saving" && <span className="spinner" />}Save</button>
        {state === "saved" && <span className="ok-text">Saved.</span>}
        {state !== "idle" && state !== "saving" && state !== "saved" && <span className="err">{state}</span>}
      </div>
    </div>
  );
}
