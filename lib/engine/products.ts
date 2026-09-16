import { q } from "@/lib/db";
import type { Finding } from "./findings";
import { binomCdf, testSegment } from "./stats";
import { brandTerms, containsBrand } from "./brand";

// Analytics, Search Console and Tag Manager judged in their own right.
//
// The same discipline as the Google Ads findings: every "worse" is an exact
// test against the site's own baseline, corrected for how many things were
// looked at, and nothing is compared with an outside benchmark.

type Row = any;
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

// ------------------------------------------------------------- analytics --

export async function analytics(clientId: number): Promise<Finding[]> {
  const out: Finding[] = [];

  // A key event that has stopped. Expected count from the four weeks before,
  // against zero in the last seven days while the site still gets sessions.
  const events = await q<Row>(`
    SELECT event_name,
           COALESCE(SUM(key_events) FILTER (WHERE date > CURRENT_DATE - 8), 0) AS recent,
           COALESCE(SUM(key_events) FILTER (WHERE date <= CURRENT_DATE - 8 AND date > CURRENT_DATE - 36), 0) AS before
      FROM ga4_events WHERE client_id = $1
     GROUP BY event_name
    HAVING COALESCE(SUM(key_events) FILTER (WHERE date <= CURRENT_DATE - 8 AND date > CURRENT_DATE - 36), 0) > 0
  `, [clientId]);
  const [sess] = await q<Row>(`SELECT COALESCE(SUM(sessions) FILTER (WHERE date > CURRENT_DATE - 8),0) AS recent FROM ga4_daily WHERE client_id = $1`, [clientId]);
  const [version] = await q<Row>(`SELECT version_id, version_name, first_seen FROM gtm_snapshots WHERE client_id = $1 ORDER BY first_seen DESC LIMIT 1`, [clientId]);
  const recentVersion = version && Date.now() - new Date(version.first_seen).getTime() < 21 * 864e5 ? version : null;

  for (const e of events) {
    const expected = (Number(e.before) / 28) * 7;
    if (Number(e.recent) > 0 || expected < 3 || Number(sess?.recent ?? 0) === 0) continue;
    if (Math.exp(-expected) >= 0.05 / Math.max(1, events.length)) continue;
    out.push({
      kind: `ga4_key_event_stopped_${e.event_name}`.slice(0, 60),
      product: "analytics",
      area: "tracking",
      severity: "critical",
      title: `"${e.event_name}" has not been recorded for a week`,
      detail: `It averaged about ${expected.toFixed(1)} a week over the four weeks before, and the site still had ${Number(sess.recent).toLocaleString()} sessions in the last seven days. Zero is not chance at that rate: the event has stopped firing.${recentVersion ? ` The Tag Manager container changed around then — version ${recentVersion.version_id}${recentVersion.version_name ? ` ("${recentVersion.version_name}")` : ""} went live on ${String(recentVersion.first_seen).slice(0, 10)}. Check that first.` : " Check the tag in Tag Manager's preview mode."}`,
      evidence: { event: e.event_name, expectedPerWeek: expected, lastWeek: 0, sessionsLastWeek: Number(sess.recent), gtmVersion: recentVersion },
    });
  }

  // Key events per session, this four weeks against the last.
  const [rate] = await q<Row>(`
    SELECT COALESCE(SUM(sessions) FILTER (WHERE date > CURRENT_DATE - 29),0) AS s_now,
           COALESCE(SUM(key_events) FILTER (WHERE date > CURRENT_DATE - 29),0) AS k_now,
           COALESCE(SUM(sessions) FILTER (WHERE date <= CURRENT_DATE - 29 AND date > CURRENT_DATE - 57),0) AS s_prev,
           COALESCE(SUM(key_events) FILTER (WHERE date <= CURRENT_DATE - 29 AND date > CURRENT_DATE - 57),0) AS k_prev
      FROM ga4_daily WHERE client_id = $1
  `, [clientId]);
  if (rate) {
    const now = { spend: Number(rate.s_now), conversions: Number(rate.k_now) };
    const prev = { spend: Number(rate.s_prev), conversions: Number(rate.k_prev) };
    if (now.spend > 0 && prev.spend > 0 && prev.conversions > 0) {
      const t = testSegment(now, { spend: now.spend + prev.spend, conversions: now.conversions + prev.conversions }, 1, "worse");
      const rNow = now.conversions / now.spend, rPrev = prev.conversions / prev.spend;
      if (t.significant && rNow <= rPrev * 0.7) {
        out.push({
          kind: "ga4_key_event_rate_drop", product: "analytics", area: "tracking", severity: "warning",
          title: `Key events per session fell ${pct(1 - rNow / rPrev)} in the last four weeks`,
          detail: `${pct(rNow)} of sessions produced a key event, against ${pct(rPrev)} in the four weeks before, on ${now.spend.toLocaleString()} sessions — ${now.conversions.toFixed(0)} key events where the earlier rate predicts about ${t.expected.toFixed(0)}. Either fewer visitors are converting or part of the tracking broke; the event list below shows which event moved.`,
          evidence: { now, prev, expected: t.expected, p: t.p },
        });
      }
    }
  }

  // Traffic Analytics cannot attribute: usually untagged links or a broken referral chain.
  const channels = await q<Row>(`SELECT channel, SUM(sessions) AS s FROM ga4_daily WHERE client_id = $1 AND date > CURRENT_DATE - 91 GROUP BY channel`, [clientId]);
  const totalSessions = channels.reduce((n, c) => n + Number(c.s), 0);
  const unassigned = channels.filter((c) => /unassigned|\(other\)|\(not set\)/i.test(c.channel)).reduce((n, c) => n + Number(c.s), 0);
  if (totalSessions >= 500 && unassigned / totalSessions >= 0.1) {
    out.push({
      kind: "ga4_unassigned_traffic", product: "analytics", area: "tracking", severity: "warning",
      title: `${pct(unassigned / totalSessions)} of sessions are "Unassigned"`,
      detail: `${unassigned.toLocaleString()} of ${totalSessions.toLocaleString()} sessions in 90 days could not be put in any channel. That is usually links carrying UTM parameters Analytics does not recognise, or campaign traffic arriving without a click identifier. Whatever it is, those visits are missing from every channel comparison.`,
      evidence: { unassigned, totalSessions },
    });
  }

  // Self-referrals and payment gateways appearing as referrers split one visit into two.
  const [site] = await q<Row>(`SELECT website FROM clients WHERE id = $1`, [clientId]);
  const host = (() => { try { return new URL(site?.website ?? "").host.replace(/^www\./, ""); } catch { return null; } })();
  const referrals = await q<Row>(`SELECT key, sessions FROM ga4_dims WHERE client_id = $1 AND dim_type = 'source_medium' AND key ILIKE '% / referral'`, [clientId]);
  const bad = referrals.filter((r) => {
    const src = String(r.key).split(" / ")[0].toLowerCase();
    return (host && src.includes(host)) || /paypal|stripe|wspay|monri|nestpay|payten|allsecure|checkout|3dsecure|bank/.test(src);
  });
  const badSessions = bad.reduce((n, r) => n + Number(r.sessions), 0);
  const [allSessions] = await q<Row>(`SELECT COALESCE(SUM(sessions),0) AS s FROM ga4_dims WHERE client_id = $1 AND dim_type = 'source_medium'`, [clientId]);
  if (bad.length && badSessions >= 20 && badSessions / Math.max(1, Number(allSessions?.s)) >= 0.01) {
    out.push({
      kind: "ga4_self_referral", product: "analytics", area: "tracking", severity: "warning",
      title: `${bad.map((b) => b.key.split(" / ")[0]).slice(0, 3).join(", ")} ${bad.length === 1 ? "appears" : "appear"} as a referrer`,
      detail: `${badSessions.toLocaleString()} sessions in 90 days started from ${bad.length === 1 ? "this site" : "these sites"}. When the business's own domain or a payment page shows up as a referrer, a visitor who went there and came back is counted as a new session from it — and the conversion is credited to the payment page instead of the ad or search that brought them. Add ${bad.length === 1 ? "it" : "them"} to the unwanted referrals list in the data stream settings.`,
      evidence: { referrers: bad },
    });
  }

  // Devices: mobile converting far worse than desktop is usually the page, not the traffic.
  const devices = await q<Row>(`SELECT key, sessions, key_events FROM ga4_dims WHERE client_id = $1 AND dim_type = 'device'`, [clientId]);
  const mobile = devices.find((d) => d.key === "mobile"), desktop = devices.find((d) => d.key === "desktop");
  if (mobile && desktop && Number(desktop.key_events) >= 5) {
    const m = { spend: Number(mobile.sessions), conversions: Number(mobile.key_events) };
    const d = { spend: Number(desktop.sessions), conversions: Number(desktop.key_events) };
    const t = testSegment(m, { spend: m.spend + d.spend, conversions: m.conversions + d.conversions }, 1, "worse");
    const rm = m.conversions / Math.max(1, m.spend), rd = d.conversions / Math.max(1, d.spend);
    if (t.significant && rm <= rd * 0.6) {
      out.push({
        kind: "ga4_mobile_gap", product: "analytics", area: "creative", severity: "warning",
        title: `Mobile visitors convert at ${pct(rm / rd)} of the desktop rate`,
        detail: `${pct(rm)} of mobile sessions produce a key event against ${pct(rd)} on desktop, over 90 days and ${m.spend.toLocaleString()} mobile sessions. A gap that large is usually the mobile page — the form, the phone number, the load time — rather than the people. It matters most where most paid clicks are mobile.`,
        evidence: { mobile: m, desktop: d, p: t.p },
      });
    }
  }

  // Landing pages, all channels, whose visitors engage far less than the site's.
  const pages = await q<Row>(`SELECT page, SUM(sessions) AS s, SUM(engaged_sessions) AS e, SUM(key_events) AS k FROM ga4_pages WHERE client_id = $1 GROUP BY page`, [clientId]);
  const ps = pages.reduce((n, p) => n + Number(p.s), 0), pe = pages.reduce((n, p) => n + Number(p.e), 0);
  if (ps >= 300) {
    const siteRate = pe / ps;
    const judged = pages.filter((p) => Number(p.s) >= 100);
    const weak = judged
      .map((p) => ({ page: p.page, sessions: Number(p.s), engaged: Number(p.e), keyEvents: Number(p.k), rate: Number(p.e) / Number(p.s), p: binomCdf(Number(p.e), Number(p.s), siteRate) }))
      .filter((p) => p.p < 0.05 / Math.max(1, judged.length) && p.rate <= siteRate * 0.7)
      .sort((a, b) => b.sessions - a.sessions).slice(0, 10);
    if (weak.length) {
      out.push({
        kind: "ga4_weak_landing_pages", product: "analytics", area: "creative", severity: "info",
        title: `${weak.length} landing page${weak.length === 1 ? " loses" : "s lose"} visitors far faster than the rest of the site`,
        detail: `"${weak[0].page}" had ${weak[0].sessions.toLocaleString()} sessions in 90 days and ${pct(weak[0].rate)} were engaged, against ${pct(siteRate)} site-wide. These are the pages where an arriving visitor most often leaves without doing anything.`,
        evidence: { siteRate, pages: weak },
        table: { columns: ["Page", "Sessions", "Engaged", "Key events"], rows: weak.map((w) => [w.page, w.sessions, pct(w.rate), w.keyEvents]) },
      });
    }
  }
  return out;
}

// -------------------------------------------------------- search console --

export async function searchConsole(clientId: number): Promise<Finding[]> {
  const out: Finding[] = [];
  const brands = await brandTerms(clientId);

  const queries = await q<Row>(`
    SELECT query, SUM(clicks) AS clicks, SUM(impressions) AS imp,
           SUM(position * impressions) / NULLIF(SUM(impressions),0) AS pos,
           (array_agg(page ORDER BY impressions DESC))[1] AS top_page,
           count(*) AS pages
      FROM gsc_query_pages WHERE client_id = $1 AND query <> ''
     GROUP BY query
  `, [clientId]);

  // Just off page one: the cheapest organic traffic to win.
  const near = queries
    .map((r) => ({ query: r.query, clicks: Number(r.clicks), impressions: Number(r.imp), position: Number(r.pos), page: r.top_page }))
    .filter((r) => r.impressions >= 200 && r.position >= 8 && r.position <= 20 && !containsBrand(r.query, brands))
    .sort((a, b) => b.impressions - a.impressions).slice(0, 20);
  if (near.length) {
    out.push({
      kind: "gsc_striking_distance", product: "search_console", area: "opportunity", severity: "info",
      title: `${near.length} search${near.length === 1 ? "" : "es"} sit just off page one`,
      detail: `"${near[0].query}" showed the site ${near[0].impressions.toLocaleString()} times in 90 days at an average position of ${near[0].position.toFixed(1)}. From positions 8 to 20 a page gets almost no clicks, and a modest improvement to the page Google already ranks — clearer headings for the search, an internal link, a better answer — moves it onto page one.`,
      evidence: { queries: near },
      table: { columns: ["Search", "Impressions", "Clicks", "Position", "Page Google ranks"], rows: near.map((n) => [n.query, n.impressions, n.clicks, Math.round(n.position * 10) / 10, n.page]) },
    });
  }

  // Click-through far below what this site gets at the same position.
  const buckets = [[0, 2], [2, 3], [3, 5]] as const;
  const bucketCtr = buckets.map(([lo, hi]) => {
    const inB = queries.filter((r) => Number(r.pos) > lo && Number(r.pos) <= hi);
    const imp = inB.reduce((n, r) => n + Number(r.imp), 0);
    return imp >= 1000 ? inB.reduce((n, r) => n + Number(r.clicks), 0) / imp : null;
  });
  const candidates = queries.filter((r) => Number(r.imp) >= 300 && Number(r.pos) <= 5 && !containsBrand(r.query, brands));
  const lowCtr = candidates
    .map((r) => {
      const b = buckets.findIndex(([lo, hi]) => Number(r.pos) > lo && Number(r.pos) <= hi);
      const expected = b >= 0 ? bucketCtr[b] : null;
      const ctr = Number(r.clicks) / Number(r.imp);
      return { query: r.query, impressions: Number(r.imp), clicks: Number(r.clicks), position: Number(r.pos), page: r.top_page, ctr, expected,
        p: expected ? binomCdf(Number(r.clicks), Number(r.imp), expected) : 1 };
    })
    .filter((r) => r.expected && r.p < 0.05 / Math.max(1, candidates.length) && r.ctr <= r.expected * 0.5)
    .sort((a, b) => b.impressions - a.impressions).slice(0, 15);
  if (lowCtr.length) {
    out.push({
      kind: "gsc_low_ctr", product: "search_console", area: "creative", severity: "warning",
      title: `${lowCtr.length} well-ranked search${lowCtr.length === 1 ? " gets" : "es get"} far fewer clicks than its position should`,
      detail: `"${lowCtr[0].query}" ranks at ${lowCtr[0].position.toFixed(1)} but only ${pct(lowCtr[0].ctr)} of people click, against ${pct(lowCtr[0].expected!)} for this site's other searches at that position. The ranking is already won; the title and description in the result are losing the click. Rewriting them for what people are searching is the fix.`,
      evidence: { queries: lowCtr },
      table: { columns: ["Search", "Position", "Impressions", "Click-through", "Site at that position", "Page"], rows: lowCtr.map((l) => [l.query, Math.round(l.position * 10) / 10, l.impressions, pct(l.ctr), pct(l.expected!), l.page]) },
    });
  }

  // Pages losing clicks, this four weeks against the last.
  const pages = await q<Row>(`SELECT page, clicks, prev_clicks, position, prev_position, impressions, prev_impressions FROM gsc_pages WHERE client_id = $1 AND prev_clicks >= 20`, [clientId]);
  const declining = pages
    .map((p) => {
      const now = Number(p.clicks), prev = Number(p.prev_clicks);
      const t = testSegment({ spend: 1, conversions: now }, { spend: 2, conversions: now + prev }, pages.length, "worse");
      return { page: p.page, now, prev, pos: p.position != null ? Number(p.position) : null, prevPos: p.prev_position != null ? Number(p.prev_position) : null,
        impNow: Number(p.impressions), impPrev: Number(p.prev_impressions), t };
    })
    .filter((p) => p.t.significant && p.now <= p.prev * 0.7)
    .sort((a, b) => (b.prev - b.now) - (a.prev - a.now)).slice(0, 10);
  if (declining.length) {
    const d = declining[0];
    const cause = d.pos != null && d.prevPos != null && d.pos > d.prevPos + 1
      ? `its average position slipped from ${d.prevPos.toFixed(1)} to ${d.pos.toFixed(1)}, so this is ranking`
      : d.impNow < d.impPrev * 0.7 ? `its impressions fell from ${d.impPrev.toLocaleString()} to ${d.impNow.toLocaleString()} at a steady position, so fewer people are searching`
      : `position and impressions held, so fewer searchers are choosing it`;
    out.push({
      kind: "gsc_pages_declining", product: "search_console", area: "opportunity", severity: "warning",
      title: `${declining.length} page${declining.length === 1 ? " is" : "s are"} losing organic clicks`,
      detail: `"${d.page}" went from ${d.prev} clicks to ${d.now} in four weeks — ${cause}. The drop is larger than week-to-week noise.`,
      evidence: { pages: declining.map(({ t, ...x }) => ({ ...x, p: t.p })) },
      table: { columns: ["Page", "Clicks now", "Before", "Position now", "Before"], rows: declining.map((x) => [x.page, x.now, x.prev, x.pos != null ? Math.round(x.pos * 10) / 10 : "—", x.prevPos != null ? Math.round(x.prevPos * 10) / 10 : "—"]) },
    });
  }

  // Two pages competing for one search.
  const split = await q<Row>(`
    WITH per AS (
      SELECT query, page, impressions, SUM(impressions) OVER (PARTITION BY query) AS total
        FROM gsc_query_pages WHERE client_id = $1 AND query <> ''
    )
    SELECT query, total, array_agg(page ORDER BY impressions DESC) AS pages
      FROM per WHERE total >= 100 AND impressions >= total * 0.25
     GROUP BY query, total HAVING count(*) >= 2
     ORDER BY total DESC LIMIT 10
  `, [clientId]);
  if (split.length) {
    out.push({
      kind: "gsc_cannibalisation", product: "search_console", area: "structure", severity: "info",
      title: `${split.length} search${split.length === 1 ? " is" : "es are"} split between two or more of the site's pages`,
      detail: `For "${split[0].query}", Google alternates between ${split[0].pages.slice(0, 3).map((p: string) => `"${p}"`).join(" and ")}, each taking at least a quarter of the impressions. When two pages compete, neither ranks as well as one clear page would. Decide which page should own the search and point the other to it.`,
      evidence: { queries: split },
      table: { columns: ["Search", "Impressions", "Pages"], rows: split.map((s) => [s.query, Number(s.total), s.pages.join(" · ")]) },
    });
  }

  // The whole site, four weeks against four weeks.
  const [tot] = await q<Row>(`
    SELECT COALESCE(SUM(clicks) FILTER (WHERE date > CURRENT_DATE - 31),0) AS now,
           COALESCE(SUM(clicks) FILTER (WHERE date <= CURRENT_DATE - 31 AND date > CURRENT_DATE - 59),0) AS prev
      FROM gsc_totals WHERE client_id = $1
  `, [clientId]);
  if (tot && Number(tot.prev) >= 50) {
    const now = Number(tot.now), prev = Number(tot.prev);
    const t = testSegment({ spend: 1, conversions: now }, { spend: 2, conversions: now + prev }, 1, "worse");
    if (t.significant && now <= prev * 0.8) {
      out.push({
        kind: "gsc_site_decline", product: "search_console", area: "opportunity", severity: "warning",
        title: `Organic clicks fell ${pct(1 - now / prev)} across the site`,
        detail: `${now.toLocaleString()} clicks from Google search in the last four weeks against ${prev.toLocaleString()} in the four before. The pages list shows where it went.`,
        evidence: { now, prev, p: t.p },
      });
    }
  }
  return out;
}

// ----------------------------------------------------------- tag manager --

// Tag Manager's own built-in triggers (All Pages, Initialization, Consent
// Initialization) have IDs in this range and never appear in the trigger list.
const BUILT_IN = (id: string) => Number(id) >= 2147479000;

export async function tagManager(clientId: number): Promise<Finding[]> {
  const out: Finding[] = [];
  const [tags, triggers, versions] = await Promise.all([
    q<Row>(`SELECT tag_id, name, type, paused, firing_triggers, parameters FROM gtm_tags WHERE client_id = $1`, [clientId]),
    q<Row>(`SELECT trigger_id FROM gtm_triggers WHERE client_id = $1`, [clientId]),
    q<Row>(`SELECT version_id, version_name, first_seen FROM gtm_snapshots WHERE client_id = $1 ORDER BY first_seen DESC LIMIT 2`, [clientId]),
  ]);
  if (!tags.length) return out;
  const live = tags.filter((t) => !t.paused);

  // The same Google tag installed twice sends every page view and event twice.
  const byId = new Map<string, Row[]>();
  for (const t of live.filter((x) => /^(googtag|gaawc)$/.test(x.type ?? ""))) {
    const id = t.parameters?.tagId ?? t.parameters?.measurementId;
    if (!id) continue;
    byId.set(id, [...(byId.get(id) ?? []), t]);
  }
  for (const [id, group] of byId) {
    if (group.length < 2) continue;
    out.push({
      kind: `gtm_duplicate_google_tag_${id}`.slice(0, 60), product: "tag_manager", area: "tracking", severity: "warning",
      title: `The Google tag ${id} is installed ${group.length} times`,
      detail: `${group.map((g) => `"${g.name}"`).join(" and ")} both load ${id}. If they fire on the same pages, Analytics counts page views and events twice — which inflates engagement and every key event, and anything imported from it into Google Ads. Keep one.`,
      evidence: { id, tags: group.map((g) => g.name) },
    });
  }

  // Live tags that nothing fires, or that point at triggers which no longer exist.
  const known = new Set(triggers.map((t) => String(t.trigger_id)));
  const neverFire = live.filter((t) => !(t.firing_triggers ?? []).length);
  // Triggers are read since a later sync; before that, every custom trigger would look missing.
  const broken = known.size ? live.filter((t) => (t.firing_triggers ?? []).some((id: string) => !BUILT_IN(id) && !known.has(String(id)))) : [];
  if (neverFire.length || broken.length) {
    out.push({
      kind: "gtm_tags_that_cannot_fire", product: "tag_manager", area: "tracking", severity: broken.some((t) => /awct|gaawe|googtag/.test(t.type ?? "")) ? "warning" : "info",
      title: `${neverFire.length + broken.length} live tag${neverFire.length + broken.length === 1 ? " has" : "s have"} nothing that can fire ${neverFire.length + broken.length === 1 ? "it" : "them"}`,
      detail: `${[...neverFire, ...broken].slice(0, 4).map((t) => `"${t.name}"`).join(", ")}. A tag with no trigger, or whose trigger was deleted, sits in the container looking installed and never runs. If one of these is a conversion or Analytics tag, whatever it was meant to count is not being counted.`,
      evidence: { noTrigger: neverFire.map((t) => t.name), missingTrigger: broken.map((t) => t.name) },
    });
  }

  if (!live.some((t) => /^(googtag|gaawc)$/.test(t.type ?? ""))) {
    const [ga] = await q<Row>(`SELECT 1 FROM client_properties WHERE client_id = $1 AND provider = 'ga4'`, [clientId]);
    if (ga) {
      out.push({
        kind: "gtm_no_google_tag", product: "tag_manager", area: "tracking", severity: "info",
        title: "No Google tag in the container",
        detail: "Analytics is connected to this project, but the container loads no Google tag. Analytics may be installed directly in the site's code instead — which is fine — but then Tag Manager cannot be used to add events to it, and a change to the site can remove it without anyone noticing here.",
        evidence: {},
      });
    }
  }

  if (versions[0] && versions[1] && Date.now() - new Date(versions[0].first_seen).getTime() < 14 * 864e5) {
    out.push({
      kind: "gtm_container_changed", product: "tag_manager", area: "tracking", severity: "info",
      title: `The container changed ${Math.max(1, Math.round((Date.now() - new Date(versions[0].first_seen).getTime()) / 864e5))} days ago`,
      detail: `Version ${versions[0].version_id}${versions[0].version_name ? ` ("${versions[0].version_name}")` : ""} went live around ${String(versions[0].first_seen).slice(0, 10)}, replacing version ${versions[1].version_id}. When conversions or key events move in the days after a container change, the change is the first place to look.`,
      evidence: { current: versions[0], previous: versions[1] },
    });
  }
  return out;
}

/** From the last check of the live site: tags that should be there and are not. */
export async function siteTags(clientId: number): Promise<Finding[]> {
  const [row] = await q<Row>(`SELECT result, checked_at FROM tag_checks WHERE client_id = $1 AND checked_at > now() - interval '8 days'`, [clientId]);
  const c = row?.result;
  if (!c?.website || !c.pages?.some((p: Row) => p.ok)) return [];
  const out: Finding[] = [];
  const add = (kind: string, severity: Finding["severity"], title: string, detail: string, evidence: Record<string, unknown>) =>
    out.push({ kind, product: "tag_manager", area: "tracking", severity, title, detail, evidence });

  if (c.tagManager?.id && !c.tagManager.where.directOnPages.length) {
    add("site_gtm_container_missing", "critical", `The Tag Manager container ${c.tagManager.id} is not on the website`,
      `None of the ${c.pages.filter((p: Row) => p.ok).length} pages checked loads it, so every tag inside it — conversion tags included — does not run there. Either the site loads a different container${c.otherIdsOnSite?.some((o: Row) => o.id.startsWith("GTM-")) ? ` (${c.otherIdsOnSite.filter((o: Row) => o.id.startsWith("GTM-")).map((o: Row) => o.id).join(", ")} is on the site)` : ""}, or the snippet was removed.`,
      { container: c.tagManager.id, pages: c.pages });
  }
  for (const [key, label] of [["ads", "Google Ads"], ["analytics", "Analytics"]] as const) {
    const t = c[key];
    if (!t?.id) continue;
    if (t.status === "configured_not_live") {
      add(`site_${key}_tag_not_live`, "critical", `The ${label} tag ${t.id} is set up in Tag Manager but not live on the site`,
        `It is configured in the connected container, but the container the website actually loads does not include it. Publish the container, or check that the site uses the same container.`, { id: t.id, where: t.where });
    } else if (t.status === "not_found") {
      add(`site_${key}_tag_missing`, "critical", `The ${label} tag ${t.id} is not on the website`,
        `It is not in the page code of the pages checked, nor in any Tag Manager container the site loads, and ${key === "ads" ? "no conversion has arrived in the last two weeks" : "Analytics has recorded no sessions in the last three days"}. Nothing is being measured for it.`, { id: t.id });
    }
  }
  const missing = (c.ads?.actions ?? []).filter((a: Row) => a.primary && a.label && !a.found && !a.lastReceived);
  if (missing.length) {
    add("site_conversion_labels_missing", "warning", `${missing.length} primary conversion action${missing.length === 1 ? " has" : "s have"} no tag on the site`,
      `${missing.slice(0, 3).map((a: Row) => `"${a.name}"`).join(", ")} ${missing.length === 1 ? "counts" : "count"} toward bidding, but ${missing.length === 1 ? "its" : "their"} conversion label is neither on the pages checked nor in the live container, and nothing has been recorded. Smart Bidding is optimising towards an action that cannot fire.`,
      { actions: missing });
  }
  if (c.otherIdsOnSite?.length) {
    add("site_unknown_google_ids", "info", `${c.otherIdsOnSite.length} other Google ID${c.otherIdsOnSite.length === 1 ? "" : "s"} on the website`,
      `${c.otherIdsOnSite.map((o: Row) => `${o.id} (${o.kind})`).join(", ")}. Not connected to this project — an old install, someone else's tag, or tracking that sends data somewhere nobody is reading.`,
      { ids: c.otherIdsOnSite });
  }
  return out;
}

export async function productFindings(clientId: number): Promise<Finding[]> {
  const groups = await Promise.all([analytics(clientId), searchConsole(clientId), tagManager(clientId), siteTags(clientId)]
    .map((p) => p.catch((err) => { console.error("[product findings]", (err as Error).message); return [] as Finding[]; })));
  return groups.flat();
}
