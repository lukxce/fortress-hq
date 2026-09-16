"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Draft, DraftGroup, Problem } from "@/lib/builder/draft";
import { money } from "@/lib/format";
import { Dialog } from "@/components/ui/Dialog";

type Conversion = { name: string; category: string; last_received_at: string | null; conversions_30d: number };

const STEPS = ["Your business", "What counts as a win", "Where to advertise", "What people search", "Your ads", "Your budget", "Check and launch"];
const MATCH_LABEL = { EXACT: "This exact search", PHRASE: "Searches containing this", BROAD: "Related searches too" } as const;
const SOURCE_LABEL = { search_console: "Search Console", converting: "Already converts", site: "On your site", suggested: "Suggested", manual: "Added by you" } as const;

/** Drop empty trailing fields, keep gaps in the middle where the operator left them. */
function trimTail(xs: string[]): string[] {
  let end = xs.length;
  while (end > 0 && !xs[end - 1]) end--;
  return xs.slice(0, end);
}

function Why({ children }: { children: React.ReactNode }) {
  return (
    <details className="why">
      <summary>Why are we suggesting this?</summary>
      <p>{children}</p>
    </details>
  );
}

export function CampaignWizard({ clientId, draftId, initial, initialStep, status, conversions, currency, defaultUrl, launchLog }: {
  clientId: number; draftId: number; initial: Draft; initialStep: number; status: string;
  conversions: Conversion[]; currency: string | null; defaultUrl: string; launchLog: { step: string; status: string; error: string | null }[];
}) {
  const router = useRouter();
  const [d, setD] = useState<Draft>({ ...initial, business: { ...initial.business, url: initial.business.url || defaultUrl } });
  const [step, setStep] = useState(Math.min(Math.max(initialStep, 1), 7));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [launched, setLaunched] = useState(status === "launched");
  const [log, setLog] = useState(launchLog);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locked = status === "launched" || launched;

  // Save as you go. A draft is never lost to a closed tab.
  useEffect(() => {
    if (locked) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const res = await fetch("/api/drafts", { method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ client: clientId, id: draftId, state: d, step }) });
      const b = await res.json().catch(() => ({}));
      if (b.problems) setProblems(b.problems);
    }, 600);
  }, [d, step, clientId, draftId, locked]);

  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setGroup = (i: number, patch: Partial<DraftGroup>) =>
    setD((x) => ({ ...x, groups: x.groups.map((g, j) => (j === i ? { ...g, ...patch } : g)) }));

  async function call<T>(label: string, url: string, init: RequestInit): Promise<T | null> {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(url, init);
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.message ?? b.error ?? "Something went wrong.");
      return b as T;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }
  const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  // ---------------------------------------------------------------- steps --

  const summary = d.business.summary as any;

  const step1 = (
    <div className="stack">
      <div>
        <h2>What does the business sell?</h2>
        <p className="meta">Fortress reads the website and says back what it understood. Correct anything wrong before going on.</p>
      </div>
      <div className="row">
        <input type="url" value={d.business.url} placeholder="https://" onChange={(e) => set({ business: { ...d.business, url: e.target.value } })} style={{ maxWidth: 420 }} />
        <button className="btn btn-primary" disabled={!d.business.url || busy !== null || locked}
          onClick={async () => {
            const b = await call<{ summary: unknown }>("site", "/api/builder/site", post({ client: clientId, url: d.business.url }));
            if (b) set({ business: { ...d.business, summary: b.summary as any } });
          }}>
          {busy === "site" && <span className="spinner" />}{summary ? "Read it again" : "Read the website"}
        </button>
      </div>
      {summary && (
        <div className="card card-pad stack-sm" style={{ background: "var(--ground)" }}>
          <p style={{ fontSize: 15 }}>{summary.business}</p>
          <dl className="kv">
            <dt>Sells</dt><dd>{(summary.offers ?? []).map((o: any) => o.name).join(", ") || "—"}</dd>
            <dt>To</dt><dd>{summary.audience || "—"}</dd>
            <dt>Where</dt><dd>{(summary.places ?? []).join(", ") || "Not stated on the site"}</dd>
            <dt>Phone</dt><dd>{summary.phone || "Not found"}</dd>
            <dt>Language</dt><dd>{summary.language}</dd>
          </dl>
          {summary.sellingPoints?.length > 0 && <p className="meta">Claims the site makes: {summary.sellingPoints.join(" · ")}</p>}
        </div>
      )}
    </div>
  );

  const stale = conversions.filter((c) => c.last_received_at && Date.now() - new Date(c.last_received_at).getTime() > 14 * 864e5);
  const step2 = (
    <div className="stack">
      <div>
        <h2>What counts as a win</h2>
        <p className="meta">A new campaign optimises toward the account&rsquo;s primary conversion actions. If those are wrong, the campaign learns the wrong thing from its first day.</p>
      </div>
      {conversions.length ? (
        <div className="card">
          <table>
            <thead><tr><th>Counts as a win</th><th className="r">Last 30 days</th><th>Last hit</th></tr></thead>
            <tbody>{conversions.map((c) => (
              <tr key={c.name}>
                <td><div className="cell-name">{c.name}</div><div className="cell-sub">{c.category.toLowerCase().replace(/_/g, " ")}</div></td>
                <td className="num r">{Number(c.conversions_30d).toFixed(0)}</td>
                <td className={stale.includes(c) ? "bad-text" : "meta"}>{c.last_received_at ? new Date(c.last_received_at).toLocaleDateString("en-GB") : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="notice notice-bad"><div><strong>Nothing is counted as a conversion yet.</strong> Set up tracking first — a campaign with nothing to optimise toward can only buy clicks. <a href={`/clients/${clientId}/tracking`}>Go to conversion tracking →</a></div></div>
      )}
      {stale.length > 0 && <div className="notice notice-warn"><div>{stale.map((s) => `"${s.name}"`).join(", ")} {stale.length === 1 ? "has" : "have"} not received a hit in over two weeks. <a href={`/clients/${clientId}/tracking`}>Check tracking first →</a></div></div>}
    </div>
  );

  const [placeQuery, setPlaceQuery] = useState("");
  const [places, setPlaces] = useState<{ id: string; name: string; type: string | null }[]>([]);
  const step3 = (
    <div className="stack">
      <div>
        <h2>Where to advertise</h2>
        <p className="meta">Towns, regions or countries. Ads show to people in these places.</p>
      </div>
      <div className="row">
        <input type="search" value={placeQuery} placeholder="Niš, Beograd, Srbija…" style={{ maxWidth: 320 }}
          onChange={(e) => setPlaceQuery(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const b = await call<{ locations: typeof places }>("places", `/api/builder/locations?client=${clientId}&q=${encodeURIComponent(placeQuery)}`, {});
            setPlaces(b?.locations ?? []);
          }} />
        <button className="btn" disabled={placeQuery.length < 2 || busy !== null} onClick={async () => {
          const b = await call<{ locations: typeof places }>("places", `/api/builder/locations?client=${clientId}&q=${encodeURIComponent(placeQuery)}`, {});
          setPlaces(b?.locations ?? []);
        }}>{busy === "places" && <span className="spinner" />}Find</button>
      </div>
      {places.length > 0 && (
        <div className="candidates">
          {places.map((p) => (
            <button key={p.id} className="cand" onClick={() => { if (!d.locations.some((l) => l.id === p.id)) set({ locations: [...d.locations, { id: p.id, name: p.name }] }); }}>
              + {p.name}{p.type ? <span className="meta"> · {p.type.toLowerCase()}</span> : null}
            </button>
          ))}
        </div>
      )}
      <div className="candidates">
        {d.locations.map((l) => (
          <span key={l.id} className="cand picked">{l.name} <button className="btn btn-quiet btn-sm" style={{ padding: "0 4px" }} onClick={() => set({ locations: d.locations.filter((x) => x.id !== l.id) })} aria-label={`Remove ${l.name}`}>✕</button></span>
        ))}
        {!d.locations.length && <span className="meta">No places chosen yet.</span>}
      </div>
      <div className="grid-2" style={{ gap: 8 }}>
        <button className={`choice${d.presence === "PRESENCE" ? " selected" : ""}`} onClick={() => set({ presence: "PRESENCE" })}>
          <span><strong>People in or regularly in these places</strong><span className="meta">Right for a business that serves its own area.</span></span>
        </button>
        <button className={`choice${d.presence === "PRESENCE_OR_INTEREST" ? " selected" : ""}`} onClick={() => set({ presence: "PRESENCE_OR_INTEREST" })}>
          <span><strong>Also people interested in these places</strong><span className="meta">Reaches more people, including some who will never be customers.</span></span>
        </button>
      </div>
      <Why>Google&rsquo;s default also shows ads to people elsewhere who search about your area. For a tradesman who only works locally that is usually paid clicks from people out of reach. In a small city, though, &ldquo;in these places only&rdquo; can leave very little traffic — check reach after launch.</Why>
      <p className="meta">Language: from late September 2026 Google matches Search ads to the language of the ad itself, so write the ads in the language customers search in.</p>
    </div>
  );

  const step4 = (
    <div className="stack">
      <div className="spread">
        <div>
          <h2>What people search</h2>
          <p className="meta">Groups of searches, one per service. Each keyword shows where it came from.</p>
        </div>
        <button className="btn btn-primary" disabled={busy !== null || locked} onClick={async () => {
          const b = await call<{ groups: DraftGroup[] }>("groups", "/api/builder/groups", post({ client: clientId, summary, places: d.locations.map((l) => l.name) }));
          if (b?.groups?.length) set({ groups: b.groups });
        }}>{busy === "groups" && <span className="spinner" />}Suggest from your data</button>
      </div>
      <Why>Suggestions start from demand this business already has: searches Search Console shows the site appearing for, and searches that already produced conversions in Ads. Only where that evidence is thin are new ones suggested, and those are marked.</Why>
      {d.groups.map((g, i) => (
        <div key={i} className="card">
          <div className="card-head">
            <input type="text" value={g.name} onChange={(e) => setGroup(i, { name: e.target.value })} style={{ maxWidth: 320, fontWeight: 600 }} />
            <button className="btn btn-quiet btn-sm" onClick={() => set({ groups: d.groups.filter((_, j) => j !== i) })}>Remove group</button>
          </div>
          <div className="table-wrap">
            <table className="kw-table">
              <tbody>
                {g.keywords.map((k, j) => (
                  <tr key={j}>
                    <td><input type="text" value={k.text} onChange={(e) => setGroup(i, { keywords: g.keywords.map((x, n) => (n === j ? { ...x, text: e.target.value, source: "manual" } : x)) })} /></td>
                    <td>
                      <select value={k.match} onChange={(e) => setGroup(i, { keywords: g.keywords.map((x, n) => (n === j ? { ...x, match: e.target.value as any } : x)) })}>
                        {Object.entries(MATCH_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td><span className={`source ${k.source}`}>{SOURCE_LABEL[k.source]}</span></td>
                    <td className="r"><button className="btn btn-quiet btn-sm" onClick={() => setGroup(i, { keywords: g.keywords.filter((_, n) => n !== j) })} aria-label="Remove">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-pad" style={{ paddingTop: 10, paddingBottom: 12 }}>
            <button className="btn btn-sm" onClick={() => setGroup(i, { keywords: [...g.keywords, { text: "", match: "PHRASE", source: "manual" }] })}>+ Add a search</button>
          </div>
        </div>
      ))}
      <div className="row">
        <button className="btn" onClick={() => set({ groups: [...d.groups, { name: `Group ${d.groups.length + 1}`, keywords: [], finalUrl: "", headlines: [], descriptions: [], path1: "", path2: "" }] })}>+ Add a group</button>
      </div>
      <div className="field">
        <label className="label" htmlFor="negs">Searches to never show for (one per line)</label>
        <textarea id="negs" value={d.negatives.join("\n")} onChange={(e) => set({ negatives: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} placeholder={"posao\nbesplatno\nuputstvo"} />
        <p className="field-note">Jobs, free, DIY and how-to searches rarely become customers.</p>
      </div>
    </div>
  );

  const [adGroup, setAdGroup] = useState(0);
  const g = d.groups[adGroup];
  const heads = g ? [...g.headlines, ...Array(Math.max(0, 15 - g.headlines.length)).fill("")].slice(0, 15) : [];
  const descs = g ? [...g.descriptions, ...Array(Math.max(0, 4 - g.descriptions.length)).fill("")].slice(0, 4) : [];
  const domain = useMemo(() => { try { return new URL(g?.finalUrl || d.business.url).host.replace(/^www\./, ""); } catch { return "example.com"; } }, [g?.finalUrl, d.business.url]);
  const step5 = !d.groups.length ? <p className="meta">Add at least one group of searches first.</p> : (
    <div className="stack">
      <div className="spread">
        <div>
          <h2>Your ads</h2>
          <p className="meta">One ad per group. Google mixes the headlines and descriptions, so each must make sense on its own.</p>
        </div>
        <div className="tabs">
          {d.groups.map((x, i) => <button key={i} className={`tab${i === adGroup ? " active" : ""}`} onClick={() => setAdGroup(i)}>{x.name || `Group ${i + 1}`}</button>)}
        </div>
      </div>
      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", alignItems: "start" }}>
        <div className="stack-sm">
          <div className="field">
            <label className="label" htmlFor="final">The page people land on</label>
            <input id="final" type="url" value={g.finalUrl} placeholder="https://" onChange={(e) => setGroup(adGroup, { finalUrl: e.target.value })} />
          </div>
          <div className="spread">
            <div className="label">Headlines (at least 3, up to 15)</div>
            <button className="btn btn-sm" disabled={busy !== null || locked} onClick={async () => {
              const b = await call<{ headlines: string[]; descriptions: string[]; path1: string; path2: string }>("adtext", "/api/builder/adtext",
                post({ client: clientId, summary, group: { name: g.name, keywords: g.keywords.map((k) => k.text), finalUrl: g.finalUrl } }));
              if (b) setGroup(adGroup, { headlines: b.headlines, descriptions: b.descriptions, path1: g.path1 || b.path1, path2: g.path2 || b.path2 });
            }}>{busy === "adtext" && <span className="spinner" />}Suggest text</button>
          </div>
          {heads.map((h, i) => (
            <div key={i} className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
              <input type="text" value={h} placeholder={i < 3 ? `Headline ${i + 1} (required)` : `Headline ${i + 1}`}
                onChange={(e) => { const next = [...heads]; next[i] = e.target.value; setGroup(adGroup, { headlines: trimTail(next) }); }} />
              <span className={`counter${h.length > 30 ? " over" : ""}`}>{h.length}/30</span>
            </div>
          ))}
          <div className="label" style={{ marginTop: 8 }}>Descriptions (at least 2, up to 4)</div>
          {descs.map((h, i) => (
            <div key={i} className="row" style={{ gap: 8, flexWrap: "nowrap", alignItems: "flex-start" }}>
              <textarea value={h} rows={2} placeholder={i < 2 ? `Description ${i + 1} (required)` : `Description ${i + 1}`}
                onChange={(e) => { const next = [...descs]; next[i] = e.target.value; setGroup(adGroup, { descriptions: trimTail(next) }); }} />
              <span className={`counter${h.length > 90 ? " over" : ""}`}>{h.length}/90</span>
            </div>
          ))}
          <div className="field-row">
            <div className="field"><label className="label">Display path 1</label><input type="text" maxLength={15} value={g.path1} onChange={(e) => setGroup(adGroup, { path1: e.target.value })} /></div>
            <div className="field"><label className="label">Display path 2</label><input type="text" maxLength={15} value={g.path2} onChange={(e) => setGroup(adGroup, { path2: e.target.value })} /></div>
          </div>
        </div>
        <div style={{ position: "sticky", top: 20 }}>
          <div className="label" style={{ marginBottom: 8 }}>How it looks on Google</div>
          <div className="serp">
            <div className="sponsored">Sponsored</div>
            <div className="site">
              <span className="fav" />
              <div><div className="dom">{domain}</div><div className="url">{`https://${domain}`}{g.path1 ? ` › ${g.path1}` : ""}{g.path2 ? ` › ${g.path2}` : ""}</div></div>
            </div>
            <div className="title">{heads.filter(Boolean).slice(0, 3).join(" | ") || <span style={{ color: "#9aa0a6" }}>Your headlines appear here</span>}</div>
            <div className="desc">{descs.filter(Boolean).slice(0, 2).join(" ") || <span style={{ color: "#9aa0a6" }}>Your descriptions appear here</span>}</div>
          </div>
          <p className="meta" style={{ marginTop: 8 }}>Suggested text only claims what the website says. Check every line — a price, a guarantee or a response time the business cannot keep is worse than a plain ad.</p>
        </div>
      </div>
    </div>
  );

  const step6 = (
    <div className="stack">
      <div>
        <h2>Your budget</h2>
        <p className="meta">A daily amount. Google can spend up to twice it on a busy day and averages it over the month.</p>
      </div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ maxWidth: 220 }}>
          <label className="label" htmlFor="daily">Per day ({currency ?? ""})</label>
          <input id="daily" type="number" min={1} value={d.dailyBudget ?? ""} onChange={(e) => set({ dailyBudget: e.target.value ? Number(e.target.value) : null })} />
        </div>
        {d.dailyBudget && <p className="lede" style={{ margin: "0 0 8px" }}>About <span className="mark num">{money(d.dailyBudget * 30.4, currency)}</span> a month.</p>}
      </div>
      <div className="label">How Google should bid</div>
      <div className="grid-2" style={{ gap: 8 }}>
        <button className={`choice${d.bidding === "MAXIMIZE_CONVERSIONS" ? " selected" : ""}`} onClick={() => set({ bidding: "MAXIMIZE_CONVERSIONS" })}>
          <span><strong>Get as many leads as possible</strong><span className="meta">Google bids for the searches most likely to become a conversion. Needs working conversion tracking.</span></span>
        </button>
        <button className={`choice${d.bidding === "MAXIMIZE_CLICKS" ? " selected" : ""}`} onClick={() => set({ bidding: "MAXIMIZE_CLICKS" })}>
          <span><strong>Get as many clicks as possible</strong><span className="meta">For when conversions are not tracked yet. Set a maximum per click, and watch the searches closely.</span></span>
        </button>
      </div>
      {d.bidding === "MAXIMIZE_CLICKS" && (
        <div className="field" style={{ maxWidth: 220 }}>
          <label className="label" htmlFor="maxcpc">Maximum per click ({currency ?? ""})</label>
          <input id="maxcpc" type="number" value={d.maxCpc ?? ""} onChange={(e) => set({ maxCpc: e.target.value ? Number(e.target.value) : null })} />
        </div>
      )}
      <Why>There is no target cost per lead on purpose. On an account with a few dozen conversions a month, a target is more likely to cost leads than to save money, and Google itself suggests starting without one and adding it once the campaign has history.</Why>
    </div>
  );

  const step7 = (
    <div className="stack">
      <div>
        <h2>Check and launch</h2>
        <p className="meta">The campaign is created paused, and only switched on once every part has uploaded — so a failure halfway never leaves it half-live.</p>
      </div>
      <div className="field" style={{ maxWidth: 420 }}>
        <label className="label" htmlFor="cname">Campaign name</label>
        <input id="cname" type="text" value={d.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      {problems.length ? (
        <div className="card">
          <div className="card-head"><h3>{problems.length} thing{problems.length === 1 ? "" : "s"} to fix first</h3></div>
          <ul className="audit">
            {problems.map((p, i) => (
              <li key={i} className="bad"><span className="mark">!</span><div className="body spread"><span>{p.message}</span><button className="btn btn-sm" onClick={() => setStep(p.step)}>Fix on step {p.step}</button></div></li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="notice notice-good"><div><strong>Ready.</strong> {d.groups.length} group{d.groups.length === 1 ? "" : "s"}, {d.groups.reduce((n, x) => n + x.keywords.length, 0)} searches, {d.locations.map((l) => l.name).join(", ")}, {money(d.dailyBudget, currency)} a day.</div></div>
      )}
      {log.length > 0 && (
        <div className="card card-pad">
          <div className="label" style={{ marginBottom: 8 }}>Launch log</div>
          {log.map((s) => <div key={s.step} className={s.status === "done" ? "meta" : "err"}>{s.status === "done" ? "✓" : "✕"} {s.step}{s.error ? ` — ${s.error}` : ""}</div>)}
        </div>
      )}
      {launched ? (
        <div className="notice notice-good"><div><strong>Launched.</strong> The campaign is live in Google Ads. Give it at least two weeks before judging it — longer if it gets few conversions.</div></div>
      ) : (
        <div><button className="btn btn-primary btn-lg" disabled={problems.length > 0 || busy !== null} onClick={() => setConfirming(true)}>{log.some((s) => s.status === "failed") ? "Resume the launch" : "Launch in Google Ads"}</button></div>
      )}
    </div>
  );

  const body = [step1, step2, step3, step4, step5, step6, step7][step - 1];

  // A tick means the step is actually complete, not merely passed.
  const complete = [
    Boolean(summary),
    conversions.length > 0,
    d.locations.length > 0,
    d.groups.length > 0 && d.groups.every((x) => x.keywords.some((k) => k.text.trim())),
    d.groups.length > 0 && !problems.some((p) => p.step === 5),
    Boolean(d.dailyBudget),
    locked,
  ];

  return (
    <div className="wizard">
      <ol className="wizard-steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button className={`${step === i + 1 ? "current" : ""} ${complete[i] && step !== i + 1 ? "done" : ""}`} onClick={() => setStep(i + 1)}>
              <span className="n">{complete[i] && step !== i + 1 ? "✓" : i + 1}</span>{s}
            </button>
          </li>
        ))}
      </ol>
      <div className="card">
        <div className="card-pad" style={{ padding: "24px 26px" }}>
          {locked && step !== 7 && <div className="notice notice-good" style={{ marginBottom: 14 }}>This campaign has launched; the draft is read-only.</div>}
          {body}
          {error && <p className="err" style={{ marginTop: 14 }}>{error}</p>}
        </div>
        <div className="wizard-foot">
          <button className="btn" disabled={step === 1} onClick={() => setStep(step - 1)}>Back</button>
          {step < 7 && <button className="btn btn-primary" onClick={() => setStep(step + 1)}>Continue</button>}
        </div>
      </div>

      {confirming && (
        <Dialog onClose={() => setConfirming(false)} locked={busy === "launch"}>
            <div className="dialog-body">
              <div className="label eyebrow">Confirm a change in Google Ads</div>
              <h2>Launch &ldquo;{d.name}&rdquo;</h2>
              <p style={{ fontSize: 15 }}>
                <span className="mark">Create a Search campaign spending up to {money(d.dailyBudget, currency)} a day (about {money((d.dailyBudget ?? 0) * 30.4, currency)} a month)</span>, showing in {d.locations.map((l) => l.name).join(", ")}, with {d.groups.length} ad group{d.groups.length === 1 ? "" : "s"}.
              </p>
              <p className="meta">Created paused, switched on at the end. It starts spending as soon as it is switched on.</p>
            </div>
            <div className="dialog-foot">
              <button className="btn" onClick={() => setConfirming(false)} disabled={busy === "launch"}>Cancel</button>
              <button className="btn btn-primary" disabled={busy === "launch"} onClick={async () => {
                const b = await call<{ ok: boolean }>("launch", "/api/drafts/launch", post({ client: clientId, id: draftId, confirm: true }));
                setConfirming(false);
                const refreshed = await fetch(`/api/drafts?client=${clientId}&id=${draftId}`).then((r) => r.json()).catch(() => null);
                if (refreshed?.launchSteps) setLog(refreshed.launchSteps);
                if (b?.ok) { setLaunched(true); router.refresh(); }
              }}>{busy === "launch" && <span className="spinner" />}Launch it</button>
            </div>
        </Dialog>
      )}
    </div>
  );
}
