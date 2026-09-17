import { q } from "@/lib/db";
import type { Finding } from "./findings";
import { testSegment } from "./stats";
import { fromMicros } from "./metrics";
import { brandTerms, containsBrand, normalise } from "./brand";

type Row = any;
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const path = (u: string) => { try { const x = new URL(u); return x.pathname === "/" ? x.host : x.pathname; } catch { return u; } };

// ------------------------------------------------------------- page speed --

/**
 * Google's own thresholds, at the 75th percentile of real visits: LCP good up
 * to 2.5 s and poor past 4 s; CLS good to 0.1, poor past 0.25; INP good to
 * 200 ms, poor past 500 ms. Real-visitor (field) data is preferred; a lab
 * figure is used only where there is none, and says so.
 */
export async function speedFindings(clientId: number): Promise<Finding[]> {
  const rows = await q<Row>(`SELECT url, role, score, lab, field, field_scope FROM page_speed WHERE client_id = $1 AND strategy = 'mobile' AND error IS NULL`, [clientId]);
  if (!rows.length) return [];
  const clicks = await q<Row>(`SELECT url, SUM(clicks)::float AS clicks, SUM(cost_micros) AS cost FROM landing_pages WHERE client_id = $1 GROUP BY url`, [clientId]);
  const paidFor = (u: string) => clicks.filter((c) => { try { const a = new URL(c.url), b = new URL(u); return a.host === b.host && a.pathname === b.pathname; } catch { return false; } })
    .reduce((n, c) => ({ clicks: n.clicks + c.clicks, spend: n.spend + fromMicros(c.cost) }), { clicks: 0, spend: 0 });

  const slow = rows.map((r) => {
    const real = r.field_scope === "page" ? r.field : null;
    const lcp = real?.lcpMs ?? r.lab?.lcpMs ?? null;
    return { ...r, lcp, from: real?.lcpMs != null ? "real visitors" : "a lab test", paid: paidFor(r.url) };
  }).filter((r) => r.lcp != null && r.lcp > 4000);

  const out: Finding[] = [];
  if (slow.length) {
    const paidSlow = slow.filter((s) => s.paid.clicks > 0);
    out.push({
      kind: "speed_slow_mobile_pages", product: "website", area: "creative",
      severity: paidSlow.length ? "warning" : "info",
      title: `${slow.length} key page${slow.length === 1 ? " is" : "s are"} slow on mobile`,
      detail: `"${path(slow[0].url)}" takes ${secs(slow[0].lcp)} for its main content to appear on a phone (${slow[0].from}); Google counts anything past 4 seconds as poor.${paidSlow.length ? ` ${paidSlow.length === 1 ? "It receives" : `${paidSlow.length} of them receive`} paid clicks, so part of every click's cost is spent on people who leave before the page shows.` : ""} The PageSpeed report lists what would save the most time.`,
      evidence: { pages: slow.map((s) => ({ url: s.url, role: s.role, lcpMs: s.lcp, source: s.from, score: s.score, paidClicks: s.paid.clicks })) },
      table: { columns: ["Page", "Role", "Main content appears", "Measured by", "Score", "Paid clicks"], rows: slow.map((s) => [path(s.url), s.role, secs(s.lcp), s.from, s.score, Math.round(s.paid.clicks)]) },
    });
  }
  const shifty = rows.filter((r) => (r.field_scope === "page" ? r.field?.cls : r.lab?.cls) > 0.25);
  if (shifty.length) {
    out.push({
      kind: "speed_layout_shift", product: "website", area: "creative", severity: "info",
      title: `${shifty.length} page${shifty.length === 1 ? " jumps" : "s jump"} around while loading`,
      detail: `On "${path(shifty[0].url)}" content moves as the page loads (layout shift ${Number(shifty[0].field?.cls ?? shifty[0].lab?.cls).toFixed(2)}; poor is above 0.25). Buttons that move cause mis-taps — on a form or a phone number that is a lost enquiry.`,
      evidence: { pages: shifty.map((s) => ({ url: s.url, field: s.field, lab: s.lab })) },
    });
  }
  const laggy = rows.filter((r) => r.field_scope === "page" && r.field?.inpMs > 500);
  if (laggy.length) {
    out.push({
      kind: "speed_slow_interaction", product: "website", area: "creative", severity: "info",
      title: `${laggy.length} page${laggy.length === 1 ? " reacts" : "s react"} slowly to taps`,
      detail: `Real visitors to "${path(laggy[0].url)}" wait ${laggy[0].field.inpMs} ms for the page to respond to a tap or click (poor is over 500 ms). Usually heavy scripts — chat widgets, trackers, sliders.`,
      evidence: { pages: laggy.map((s) => ({ url: s.url, field: s.field })) },
    });
  }
  return out;
}

// ------------------------------------------------------- business profile --

export async function businessProfileFindings(clientId: number): Promise<Finding[]> {
  const out: Finding[] = [];
  const [a] = await q<Row>(`
    SELECT COALESCE(SUM(value) FILTER (WHERE date > CURRENT_DATE - 32 AND metric = ANY($2)),0)::float AS now,
           COALESCE(SUM(value) FILTER (WHERE date <= CURRENT_DATE - 32 AND date > CURRENT_DATE - 60 AND metric = ANY($2)),0)::float AS prev,
           COALESCE(SUM(value) FILTER (WHERE date > CURRENT_DATE - 32 AND metric = 'CALL_CLICKS'),0)::float AS calls,
           COALESCE(SUM(value) FILTER (WHERE date <= CURRENT_DATE - 32 AND date > CURRENT_DATE - 60 AND metric = 'CALL_CLICKS'),0)::float AS calls_prev,
           count(*)::int AS n
      FROM gbp_daily WHERE client_id = $1`, [clientId, ["CALL_CLICKS", "WEBSITE_CLICKS", "BUSINESS_DIRECTION_REQUESTS"]]);
  if (!a?.n) return out;

  // Four weeks against the four before; Search Console-style lag of about three days.
  const t = testSegment({ spend: 1, conversions: a.now }, { spend: 2, conversions: a.now + a.prev }, 1, "worse");
  if (a.prev >= 20 && t.significant && a.now <= a.prev * 0.75) {
    out.push({
      kind: "gbp_actions_drop", product: "business_profile", area: "opportunity", severity: "warning",
      title: `Calls, directions and website clicks from the Business Profile fell ${pct(1 - a.now / a.prev)}`,
      detail: `${a.now} actions in the last four weeks against ${a.prev} in the four before${a.calls_prev > 0 ? `, calls from ${a.calls_prev} to ${a.calls}` : ""}. The drop is larger than chance. Common causes: the profile was edited and is under review, opening hours are wrong, a competitor appeared in the local results, or reviews turned.`,
      evidence: a,
    });
  }

  const reviews = await q<Row>(`SELECT rating, replied, created_at, comment FROM gbp_reviews WHERE client_id = $1`, [clientId]);
  const recent = reviews.filter((r) => r.created_at && Date.now() - new Date(r.created_at).getTime() < 90 * 864e5);
  const unanswered = recent.filter((r) => !r.replied);
  if (unanswered.length) {
    const bad = unanswered.filter((r) => r.rating != null && r.rating <= 3);
    out.push({
      kind: "gbp_unanswered_reviews", product: "business_profile", area: "creative", severity: bad.length ? "warning" : "info",
      title: `${unanswered.length} review${unanswered.length === 1 ? "" : "s"} from the last 90 days ${unanswered.length === 1 ? "has" : "have"} no reply${bad.length ? `, ${bad.length} of them 3 stars or fewer` : ""}`,
      detail: `People choosing between local businesses read the replies as much as the stars — an unanswered bad review reads as a business that does not care. Reply to the low ones first, briefly and without arguing.`,
      evidence: { unanswered: unanswered.map((r) => ({ rating: r.rating, date: r.created_at })) },
    });
  }
  if (reviews.length >= 10 && recent.length >= 5) {
    const avg = (xs: Row[]) => xs.reduce((n, r) => n + (r.rating ?? 0), 0) / xs.filter((r) => r.rating != null).length;
    const older = reviews.filter((r) => !recent.includes(r));
    if (older.length >= 5 && avg(recent) <= avg(older) - 0.7) {
      out.push({
        kind: "gbp_rating_slipping", product: "business_profile", area: "creative", severity: "warning",
        title: `Recent reviews average ${avg(recent).toFixed(1)} stars, down from ${avg(older).toFixed(1)}`,
        detail: `The last 90 days' ${recent.length} reviews rate the business clearly lower than the ${older.length} before. Read them for a common complaint — it is usually one thing.`,
        evidence: { recent: recent.length, older: older.length },
      });
    }
  }
  return out;
}

// --------------------------------------------------------- keyword planner --

export async function keywordFindings(clientId: number): Promise<Finding[]> {
  const out: Finding[] = [];
  const [ideas, volumes, keywords, brands] = await Promise.all([
    q<Row>(`SELECT keyword, avg_monthly::float AS v, competition, low_bid_micros, high_bid_micros FROM keyword_ideas WHERE client_id = $1 ORDER BY avg_monthly DESC`, [clientId]),
    q<Row>(`SELECT keyword, avg_monthly::float AS v, sources FROM keyword_volumes WHERE client_id = $1`, [clientId]),
    q<Row>(`SELECT DISTINCT lower(text) AS t FROM keywords WHERE client_id = $1 AND status = 'ENABLED'`, [clientId]),
    brandTerms(clientId),
  ]);
  if (!volumes.length && !ideas.length) return out;

  // Ideas that share a word with something already converting are the relevant ones.
  const converting = volumes.filter((v) => v.sources.includes("converting search"));
  const words = new Set(converting.flatMap((c) => normalise(c.keyword).split(/\s+/).filter((w) => w.length >= 4)));
  const covered = new Set(keywords.map((k) => normalise(k.t)));
  const relevant = ideas.filter((i) => !containsBrand(i.keyword, brands) && !covered.has(normalise(i.keyword)) &&
    normalise(i.keyword).split(/\s+/).some((w) => words.has(w)));
  if (relevant.length && words.size) {
    const top = relevant.slice(0, 25);
    out.push({
      kind: "keyword_planner_ideas", product: "ads", area: "opportunity", severity: "info",
      title: `${relevant.length} search${relevant.length === 1 ? "" : "es"} related to what already converts ${relevant.length === 1 ? "is" : "are"} not covered`,
      detail: `Keyword Planner shows demand around the searches that already bring conversions — "${top[0].keyword}" is searched about ${Math.round(top[0].v).toLocaleString()} times a month where the campaigns target — and none of these is an active keyword. Volumes are Google's rounded 12-month averages: use them to choose between ideas, not to forecast.`,
      evidence: { ideas: top },
      table: { columns: ["Search", "Monthly searches", "Competition", "Top-of-page bid, low", "high"], rows: top.map((i) => [i.keyword, Math.round(i.v), i.competition ?? "—", i.low_bid_micros ? Math.round(fromMicros(i.low_bid_micros)) : null, i.high_bid_micros ? Math.round(fromMicros(i.high_bid_micros)) : null]) },
    });
  }

  const dead = volumes.filter((v) => v.sources.includes("keyword") && (v.v ?? 0) === 0);
  if (dead.length >= 5) {
    out.push({
      kind: "keyword_planner_no_volume", product: "ads", area: "structure", severity: "info",
      title: `${dead.length} active keywords have no measurable search volume`,
      detail: `Keyword Planner shows no monthly searches for them where the campaigns target. Google marks such keywords "low search volume" and does not show ads for them until searches pick up — they cost nothing, but they are not covering demand either. Broader or more common phrasings usually do.`,
      evidence: { keywords: dead.slice(0, 40).map((d) => d.keyword) },
    });
  }
  return out;
}
