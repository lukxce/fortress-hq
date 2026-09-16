import { q, q1 } from "@/lib/db";
import { clientWithProperties } from "@/lib/binding";
import { connectionForClient, clientFor } from "@/lib/google/auth";
import { searchStream, digits } from "@/lib/google/ads";
import { countOps } from "@/lib/google/quota";
import { ga4MeasurementId } from "@/lib/google/goals";

/**
 * Is each Google tag actually on the website?
 *
 * The IDs come from Google itself: the Ads account's conversion tracking ID and
 * each conversion action's label, the Analytics web stream's measurement ID,
 * and the Tag Manager container's public ID. Then the live site is read — the
 * home page and the pages paid and organic visitors land on most — along with
 * the live published container (gtm.js is public), because a tag installed
 * through Tag Manager never appears in the page source.
 *
 * What this cannot see: tags injected only after consent by a consent
 * platform, and server-side Tag Manager on a custom domain. Where a tag is not
 * found but Google is still receiving data, the page says so rather than
 * calling it missing.
 */

export type Where = { directOnPages: string[]; inLiveContainer: boolean; inContainerTags: boolean };
export type TagStatus = "installed" | "via_tag_manager" | "configured_not_live" | "not_found" | "receiving_but_not_found" | "not_connected";

export type TagCheck = {
  /** Google could not be asked for the IDs (a lapsed sign-in), so a missing ID means unknown, not absent. */
  idsUnavailable?: boolean;
  website: string | null;
  pages: { url: string; ok: boolean; status: number | null; error?: string }[];
  ads: null | { id: string | null; where: Where; status: TagStatus; lastConversionReceived: string | null;
    actions: { name: string; label: string | null; primary: boolean; found: boolean; lastReceived: string | null }[] };
  analytics: null | { id: string | null; where: Where; status: TagStatus; sessionsLast3Days: number };
  tagManager: null | { id: string | null; where: Where; status: TagStatus; liveVersion: string | null };
  otherIdsOnSite: { id: string; kind: string; foundOn: string }[];
  consentModeSeen: boolean;
  errors: string[];
  /** Google tags Fortress put into the Tag Manager workspace, waiting to be published. */
  added?: Partial<Record<"ads" | "analytics", { at: string; created: string[]; skipped: string[]; workspaceUrl: string }>>;
};

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 FortressTagCheck";

async function fetchText(url: string): Promise<{ ok: boolean; status: number | null; text: string; error?: string }> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(9000) });
    const text = (await res.text()).slice(0, 3_000_000);
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    return { ok: false, status: null, text: "", error: (err as Error).name === "TimeoutError" ? "timed out" : (err as Error).message };
  }
}

const IDS = {
  gtm: /\bGTM-[A-Z0-9]{4,10}\b/g,
  ga4: /\bG-[A-Z0-9]{6,12}\b/g,
  ads: /\bAW-\d{6,13}\b/g,
  ua: /\bUA-\d{4,10}-\d{1,4}\b/g,
};
const found = (text: string, re: RegExp) => [...new Set(text.match(re) ?? [])];

export async function runTagCheck(clientId: number): Promise<TagCheck> {
  const client = await clientWithProperties(clientId, null);
  if (!client) throw new Error("No such project.");
  const errors: string[] = [];
  const conn = await connectionForClient(clientId);
  // A lapsed Google sign-in must not stop the website from being read.
  const auth = conn ? await clientFor(conn.id).catch((err) => { errors.push(`Google sign-in: ${(err as Error).message}. Reconnect on the Connections page to pull the IDs.`); return null; }) : null;

  // ------------------------------------------------------- IDs from Google --
  let adsId: string | null = null;
  let actions: { name: string; label: string | null; primary: boolean; lastReceived: string | null }[] = [];
  if (client.ads_customer_id && auth) {
    try {
      const cid = digits(client.ads_customer_id);
      const [cust] = await searchStream(auth, cid, `SELECT customer.conversion_tracking_setting.conversion_tracking_id FROM customer`);
      const tid = cust?.customer?.conversionTrackingSetting?.conversionTrackingId;
      if (tid) adsId = `AW-${tid}`;
      const rows = await searchStream(auth, cid, `
        SELECT conversion_action.name, conversion_action.type, conversion_action.primary_for_goal, conversion_action.tag_snippets
          FROM conversion_action
         WHERE conversion_action.status = 'ENABLED' AND conversion_action.type = 'WEBPAGE'`);
      await countOps("ads", 2);
      const received = await q<any>(`SELECT name, last_received_at FROM conversion_actions WHERE client_id = $1`, [clientId]);
      actions = rows.map((r) => {
        const a = r.conversionAction ?? {};
        const snippet = (a.tagSnippets ?? []).map((s: any) => s.eventSnippet ?? "").join(" ");
        const m = snippet.match(/send_to['"]?\s*:\s*['"](AW-\d+)\/([\w-]+)['"]/);
        if (!adsId && m) adsId = m[1];
        return { name: a.name, label: m?.[2] ?? null, primary: Boolean(a.primaryForGoal), lastReceived: received.find((x) => x.name === a.name)?.last_received_at ?? null };
      });
    } catch (err) { errors.push(`Google Ads: ${(err as Error).message}`); }
  }

  let ga4Id: string | null = null;
  if (client.ga4_property_id && auth) {
    try { ga4Id = await ga4MeasurementId(auth, client.ga4_property_id); }
    catch (err) { errors.push(`Analytics: ${(err as Error).message}`); }
  }

  let gtmId: string | null = null;
  if (client.gtm_container_id) {
    const inv = await q1<any>(`SELECT i.extra FROM client_properties cp JOIN inventory i ON i.id = cp.inventory_id WHERE cp.client_id = $1 AND cp.provider = 'gtm'`, [clientId]);
    gtmId = inv?.extra?.publicId ?? null;
  }

  // ------------------------------------------------------------ the website --
  const domain = await q1<{ d: string | null }>(`
    SELECT COALESCE(c.website,
      (SELECT i.domain FROM client_properties cp JOIN inventory i ON i.id = cp.inventory_id WHERE cp.client_id = c.id AND cp.provider = 'ads'),
      (SELECT i.domain FROM client_properties cp JOIN inventory i ON i.id = cp.inventory_id WHERE cp.client_id = c.id AND cp.provider = 'gsc'),
      (SELECT i.domain FROM client_properties cp JOIN inventory i ON i.id = cp.inventory_id WHERE cp.client_id = c.id AND cp.provider = 'ga4')) AS d
      FROM clients c WHERE c.id = $1`, [clientId]);
  const website = domain?.d ? (/^https?:\/\//.test(domain.d) ? domain.d : `https://${domain.d.replace(/^sc-domain:/, "")}`) : null;

  const landing = await q<{ url: string }>(`
    (SELECT url FROM landing_pages WHERE client_id = $1 ORDER BY clicks DESC LIMIT 2)
    UNION
    (SELECT page FROM ga4_pages WHERE client_id = $1 AND page NOT IN ('(not set)', '') GROUP BY page ORDER BY SUM(sessions) DESC LIMIT 2)`, [clientId]);
  // Final URLs can carry tracking templates ({lpurl}, {ignore}); those are not pages.
  const absolute = (u: string) => {
    if (!u || /[{}]|%7B/i.test(u.split("?")[0])) return null;
    try { const x = new URL(u, website ?? undefined); x.search = ""; x.hash = ""; return x.toString(); } catch { return null; }
  };
  const urls = [...new Set([website, ...landing.map((l) => l.url)].map((u) => (u ? absolute(u) : null)).filter(Boolean) as string[])].slice(0, 4);

  const pages: TagCheck["pages"] = [];
  const onPage = new Map<string, string[]>();
  const other: TagCheck["otherIdsOnSite"] = [];
  let html = "";
  for (const url of urls) {
    const r = await fetchText(url);
    pages.push({ url, ok: r.ok, status: r.status, error: r.error });
    // An error page proves nothing about the pages people actually land on.
    if (!r.ok) continue;
    html += r.text;
    for (const [kind, re] of Object.entries(IDS)) {
      for (const id of found(r.text, re)) onPage.set(id, [...(onPage.get(id) ?? []), url]);
    }
  }

  // ------------------------------------------------ the live containers ------
  // Every container on the site, not only the bound one: the tags may live in another.
  const containers = [...new Set([...found(html, IDS.gtm), ...(gtmId ? [gtmId] : [])])];
  let containerText = "";
  const liveOnSite = new Set<string>();
  for (const id of containers) {
    const r = await fetchText(`https://www.googletagmanager.com/gtm.js?id=${id}`);
    // A container that is published but not on the site runs nothing, so only on-site ones count.
    if (r.ok && onPage.has(id)) { containerText += r.text; liveOnSite.add(id); }
  }
  // A Google tag (G-) can carry Ads destinations too.
  for (const g of found(html + containerText, IDS.ga4).slice(0, 3)) {
    const r = await fetchText(`https://www.googletagmanager.com/gtag/js?id=${g}`);
    if (r.ok) containerText += found(r.text, IDS.ads).join(" ");
  }

  const tags = await q<any>(`SELECT type, paused, parameters FROM gtm_tags WHERE client_id = $1`, [clientId]);
  const inTags = (id: string) => tags.some((t) => !t.paused && Object.values(t.parameters ?? {}).some((v) => String(v).replace(/^AW-/, "") === id.replace(/^AW-/, "")));

  const where = (id: string | null): Where => ({
    directOnPages: id ? onPage.get(id) ?? [] : [],
    // Tag Manager stores an Ads conversion ID without its "AW-" prefix.
    inLiveContainer: Boolean(id && (containerText.includes(id) || (id.startsWith("AW-") && containerText.includes(id.slice(3))))),
    inContainerTags: Boolean(id && inTags(id)),
  });
  const status = (id: string | null, w: Where, receiving: boolean): TagStatus => {
    if (!id) return "not_found";
    if (w.directOnPages.length) return "installed";
    if (w.inLiveContainer) return "via_tag_manager";
    if (w.inContainerTags) return "configured_not_live";
    return receiving ? "receiving_but_not_found" : "not_found";
  };

  const [ga4Recent] = await q<any>(`SELECT COALESCE(SUM(sessions),0)::int AS s FROM ga4_daily WHERE client_id = $1 AND date >= CURRENT_DATE - 3`, [clientId]);
  const [live] = await q<any>(`SELECT version_id, version_name FROM gtm_snapshots WHERE client_id = $1 ORDER BY first_seen DESC LIMIT 1`, [clientId]);
  const lastConv = actions.map((a) => a.lastReceived).filter(Boolean).sort().pop() ?? null;
  const convRecent = Boolean(lastConv && Date.now() - new Date(lastConv).getTime() < 14 * 864e5);

  const adsWhere = where(adsId);
  const gaWhere = where(ga4Id);
  const gtmWhere: Where = { directOnPages: gtmId ? onPage.get(gtmId) ?? [] : [], inLiveContainer: false, inContainerTags: false };

  for (const [id, pagesFound] of onPage) {
    const kind = id.startsWith("GTM-") ? "Tag Manager container" : id.startsWith("G-") ? "Google tag / Analytics" : id.startsWith("AW-") ? "Google Ads" : "Universal Analytics (switched off by Google in 2024)";
    if (id !== gtmId && id !== ga4Id && id !== adsId) other.push({ id, kind, foundOn: pagesFound[0] });
  }

  const result: TagCheck = {
    idsUnavailable: !auth, website, pages,
    ads: client.ads_customer_id ? {
      id: adsId, where: adsWhere, status: status(adsId, adsWhere, convRecent), lastConversionReceived: lastConv,
      actions: actions.map((a) => ({ ...a, found: Boolean(a.label && (html.includes(a.label) || containerText.includes(a.label))) })),
    } : null,
    analytics: client.ga4_property_id ? { id: ga4Id, where: gaWhere, status: status(ga4Id, gaWhere, ga4Recent?.s > 0), sessionsLast3Days: ga4Recent?.s ?? 0 } : null,
    tagManager: client.gtm_container_id ? {
      id: gtmId, where: gtmWhere, liveVersion: live ? `${live.version_id}${live.version_name ? ` · ${live.version_name}` : ""}` : null,
      status: !gtmId ? "not_found" : gtmWhere.directOnPages.length ? "installed" : "not_found",
    } : null,
    otherIdsOnSite: other,
    consentModeSeen: /gtag\(\s*['"]consent['"]\s*,\s*['"]default['"]/.test(html) || /consent.?mode|cookiebot|onetrust|cookieyes|usercentrics|iubenda|complianz/i.test(html + containerText),
    errors,
  };

  const previous = await q1<{ result: TagCheck }>(`SELECT result FROM tag_checks WHERE client_id = $1`, [clientId]);
  for (const k of ["ads", "analytics"] as const) {
    const pending = previous?.result?.added?.[k];
    const live = result[k] && ["installed", "via_tag_manager"].includes(result[k]!.status);
    if (pending && !live) result.added = { ...(result.added ?? {}), [k]: pending };
  }

  await q(`INSERT INTO tag_checks (client_id, result, checked_at) VALUES ($1, $2, now())
           ON CONFLICT (client_id) DO UPDATE SET result = EXCLUDED.result, checked_at = now()`, [clientId, JSON.stringify(result)]);
  return result;
}
