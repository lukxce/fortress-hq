"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Place = { id: string; name: string; type?: string | null; reach?: number | null };

const GOALS = [
  { key: "calls", title: "More phone calls", say: "People who call you from the ad or the site." },
  { key: "leads", title: "More enquiries", say: "Forms, bookings, quote requests." },
  { key: "sales", title: "More sales", say: "Orders in an online shop." },
] as const;

const COUNTRIES: [string, string][] = [["RS", "Serbia"], ["US", "United States"], ["GB", "United Kingdom"], ["DE", "Germany"], ["AT", "Austria"], ["CH", "Switzerland"], ["NL", "Netherlands"], ["HR", "Croatia"], ["BA", "Bosnia and Herzegovina"], ["ME", "Montenegro"], ["SI", "Slovenia"], ["MK", "North Macedonia"]];

const BUILDING = [
  "Reading the website",
  "Asking Keyword Planner what people search there",
  "Grouping searches by service",
  "Writing the ads",
  "Forecasting clicks and cost",
  "Checking tracking, tags and page speed",
];

/** Three questions. Everything else Fortress works out, and shows before anything is built. */
export function LaunchStart({ clientId, currency, website: initialSite, country: initialCountry }: {
  clientId: number; currency: string | null; website: string; country: string;
}) {
  const router = useRouter();
  const [goal, setGoal] = useState<"calls" | "leads" | "sales" | null>(null);
  const [country, setCountry] = useState(initialCountry);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Place[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [budget, setBudget] = useState("");
  const [website, setWebsite] = useState(initialSite);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(async () => {
      const b = await fetch(`/api/builder/locations?client=${clientId}&q=${encodeURIComponent(query)}&country=${country}`).then((r) => r.json()).catch(() => ({}));
      setFound(b.locations ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [query, country, clientId]);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setTick((n) => Math.min(BUILDING.length - 1, n + 1)), 12_000);
    return () => clearInterval(t);
  }, [busy]);

  const ready = goal && places.length && Number(budget) > 0 && /^https?:\/\/\S+\.\S+/.test(website);

  async function build() {
    if (!ready) return;
    setBusy(true); setError(null); setTick(0);
    const res = await fetch("/api/launch/propose", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client: clientId, goal, places: places.map(({ id, name }) => ({ id, name })), monthlyBudget: Number(budget), website }),
    });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) { setBusy(false); setError(b.message ?? b.error ?? "Could not build the proposal."); return; }
    router.push(`/clients/${clientId}/launch/${b.draftId}` as never);
  }

  if (busy) {
    return (
      <div className="card">
        <div className="card-head"><h2>Building your campaign</h2><span className="meta">about a minute or two</span></div>
        <ol className="setup-steps">
          {BUILDING.map((s, i) => (
            <li key={s} className={i < tick ? "done" : i === tick ? "current" : ""}>
              <span className="n">{i < tick ? "✓" : i === tick ? <span className="spinner" /> : i + 1}</span>
              <div className="body"><h4 style={{ margin: 0 }}>{s}</h4></div>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="label" style={{ marginBottom: 10 }}>1 · What do you want more of?</div>
        <div className="grid-3">
          {GOALS.map((g) => (
            <button key={g.key} type="button" className={`choice${goal === g.key ? " selected" : ""}`} onClick={() => setGoal(g.key)}>
              <div><strong>{g.title}</strong><span className="meta">{g.say}</span></div>
            </button>
          ))}
        </div>
      </div>

      <div className="card card-pad">
        <div className="label" style={{ marginBottom: 10 }}>2 · Where are your customers?</div>
        <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
          <select value={country} onChange={(e) => setCountry(e.target.value)} style={{ width: 200 }} aria-label="Country">
            {COUNTRIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input type="search" placeholder="Type a town or region…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {found.length > 0 && (
          <div className="candidates" style={{ marginTop: 10 }}>
            {found.map((p) => (
              <button key={p.id} type="button" className="cand" onClick={() => { if (!places.some((x) => x.id === p.id)) setPlaces([...places, p]); setQuery(""); setFound([]); }}>
                <span className="cand-name">{p.name}</span>{p.reach ? <span className="meta"> · reach {p.reach.toLocaleString()}</span> : null}
              </button>
            ))}
          </div>
        )}
        {places.length > 0 && (
          <div className="chips" style={{ marginTop: 12 }}>
            {places.map((p) => (
              <button key={p.id} type="button" className="chip on" onClick={() => setPlaces(places.filter((x) => x.id !== p.id))}>{p.name} ✕</button>
            ))}
          </div>
        )}
      </div>

      <div className="card card-pad">
        <div className="label" style={{ marginBottom: 10 }}>3 · How much a month, at most?</div>
        <div className="row" style={{ gap: 8, flexWrap: "nowrap", maxWidth: 360 }}>
          <input type="number" min={1} step={1} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. 300" />
          <span className="meta" style={{ whiteSpace: "nowrap" }}>{currency ?? ""} a month</span>
        </div>
        <p className="meta" style={{ marginTop: 8 }}>Google spends about this, a little more on some days and less on others. You will see what it buys before anything goes live.</p>
        <details className="why" style={{ marginTop: 10 }}>
          <summary>Website: {website || "not set"}</summary>
          <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" style={{ marginTop: 8 }} />
        </details>
      </div>

      {error && <div className="notice notice-bad"><div>{error}</div></div>}
      <div className="spread">
        <span className="meta">Nothing is created in Google Ads yet. The next screen shows the whole campaign, the forecast and what needs fixing first.</span>
        <button className="btn btn-primary btn-lg" disabled={!ready} onClick={build}>Build my campaign</button>
      </div>
    </div>
  );
}
