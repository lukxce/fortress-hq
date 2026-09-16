import { q } from "@/lib/db";

/**
 * The conversion setup audit.
 *
 * Every number anywhere in Fortress is downstream of what is counted as a
 * conversion, so this page is checked first. Each check says what it found,
 * why it matters, and what to do — in the order a fix should happen.
 */

export type Check = {
  id: string;
  status: "ok" | "warn" | "bad" | "info";
  title: string;
  detail: string;
  fix?: string;
};

const LEAD = /SUBMIT_LEAD_FORM|CONTACT|REQUEST_QUOTE|BOOK_APPOINTMENT|PHONE_CALL_LEAD|SIGNUP/;
const LATER = /QUALIFIED_LEAD|CONVERTED_LEAD|IMPORTED_LEAD/;
const WEAK = /^(PAGE_VIEW|ENGAGEMENT|OUTBOUND_CLICK|GET_DIRECTIONS)$/;

export async function auditTracking(clientId: number) {
  const [[client], actions, tags, geo, ga] = await Promise.all([
    q<any>(`SELECT c.*,
              EXISTS (SELECT 1 FROM client_properties WHERE client_id = c.id AND provider = 'ga4') AS has_ga4,
              EXISTS (SELECT 1 FROM client_properties WHERE client_id = c.id AND provider = 'gtm') AS has_gtm
             FROM clients c WHERE c.id = $1`, [clientId]),
    q<any>(`SELECT action_id, name, category, type, status, counting_type, include_in_conversions,
                   click_window_days, conversions_30d, last_received_at, origin
              FROM conversion_actions WHERE client_id = $1 AND status <> 'REMOVED'
             ORDER BY include_in_conversions DESC, conversions_30d DESC`, [clientId]),
    q<any>(`SELECT name, type, paused, consent_status FROM gtm_tags WHERE client_id = $1`, [clientId]),
    q<any>(`SELECT segment_key FROM segment_metrics WHERE client_id = $1 AND segment_type = 'geo'
             GROUP BY segment_key ORDER BY SUM(cost_micros) DESC LIMIT 1`, [clientId]),
    q<any>(`SELECT COALESCE(SUM(key_events),0) AS key_events FROM ga4_daily
             WHERE client_id = $1 AND date > CURRENT_DATE - 31`, [clientId]),
  ]);

  const s = client?.ads_settings ?? {};
  const enabled = actions.filter((a) => a.status === "ENABLED");
  const primary = enabled.filter((a) => a.include_in_conversions);
  const checks: Check[] = [];

  // 1. Is anything counted at all?
  if (!primary.length) {
    checks.push({ id: "no_primary", status: "bad", title: "Nothing is counted as a conversion",
      detail: "No enabled conversion action is primary, so bidding has nothing to optimise toward and cost per conversion cannot be measured.",
      fix: "Create a goal below for the thing that is actually a lead or a sale, and make it primary." });
  } else {
    checks.push({ id: "has_primary", status: "ok", title: `${primary.length} action${primary.length === 1 ? " is" : "s are"} counted as conversions`,
      detail: primary.map((a) => a.name).slice(0, 6).join(", ") });
  }

  // 2. Counting rules.
  const every = primary.filter((a) => LEAD.test(a.category ?? "") && a.counting_type === "MANY_PER_CLICK" && a.type !== "UPLOAD_CLICKS");
  if (every.length) {
    checks.push({ id: "counting", status: "bad", title: `${every.map((a) => `"${a.name}"`).join(", ")} ${every.length === 1 ? "counts" : "count"} every submission`,
      detail: "One person filling the form twice is still one lead. Counting both makes the ads look better than they are — the most common reason a Google conversion count runs far ahead of the real leads in a CRM.",
      fix: "Goals → Conversions → the action → Edit settings → Count → One." });
  }

  // 3. Weak signals in the primary column.
  const weak = primary.filter((a) => WEAK.test(a.category ?? ""));
  if (weak.length) {
    checks.push({ id: "weak", status: "warn", title: `${weak.map((a) => `"${a.name}"`).join(", ")} ${weak.length === 1 ? "is" : "are"} primary but not a lead`,
      detail: "Page views, engagement, outbound clicks and directions are counted as conversions, so bidding optimises toward them and finds their cheapest source.",
      fix: "Goals → Conversions → the action → Edit settings → Action optimisation → Secondary." });
  }

  // 4. One biddable stage.
  if (primary.some((a) => LEAD.test(a.category ?? "")) && primary.some((a) => LATER.test(a.category ?? ""))) {
    checks.push({ id: "stages", status: "bad", title: "Both the enquiry and the qualified lead are primary",
      detail: "One customer is counted twice at two stages. Google's rule is to bid toward one stage.",
      fix: "Keep the later stage primary once it has at least 15 conversions a month; make the enquiry secondary." });
  }
  if (primary.length > 3) {
    checks.push({ id: "many", status: "warn", title: `${primary.length} primary actions`,
      detail: "Bidding treats every one as equally valuable. With this many, some are almost certainly weak signals." });
  }

  // 5. Double counting across Analytics and the Ads tag.
  const byCat = new Map<string, any[]>();
  for (const a of primary.filter((x) => LEAD.test(x.category ?? ""))) byCat.set(a.category, [...(byCat.get(a.category) ?? []), a]);
  for (const [cat, group] of byCat) {
    if (group.some((a) => /^GOOGLE_ANALYTICS_4/.test(a.type ?? "")) && group.some((a) => /^WEBPAGE/.test(a.type ?? ""))) {
      checks.push({ id: `double_${cat}`, status: "bad", title: "The same lead may be counted twice",
        detail: `${group.map((a) => `"${a.name}"`).join(" and ")} are both primary for ${cat.toLowerCase().replace(/_/g, " ")} — one from an Analytics import, one from a Google Ads tag.`,
        fix: "Keep the Google Ads tag primary (it reaches bidding faster and on click attribution) and make the Analytics import secondary." });
    }
  }

  // 6. Tags that have gone quiet.
  for (const a of primary) {
    if (!a.last_received_at) continue;
    const days = Math.floor((Date.now() - new Date(a.last_received_at).getTime()) / 864e5);
    if (days > 14 && /^(WEBPAGE|WEBPAGE_CODELESS|CLICK_TO_CALL|GOOGLE_ANALYTICS_4_CUSTOM)$/.test(a.type ?? "")) {
      checks.push({ id: `stale_${a.action_id}`, status: "bad", title: `"${a.name}" last received a hit ${days} days ago`,
        detail: "A primary action that stops receiving hits is almost always a broken or removed tag.",
        fix: "Submit a test on the site, then check Tag Manager's preview mode to see whether the tag fires." });
    }
  }

  // 7. Account settings.
  if (s.autoTagging === false) {
    checks.push({ id: "autotag", status: "bad", title: "Auto-tagging is off",
      detail: "No click identifier reaches the site, so Analytics attribution suffers and offline conversion import cannot work.",
      fix: "Admin → Account settings → Auto-tagging → on." });
  } else if (s.autoTagging === true) {
    checks.push({ id: "autotag", status: "ok", title: "Auto-tagging is on", detail: "Click identifiers reach the site." });
  }
  if (geo[0]?.segment_key === "2688") {
    checks.push({ id: "calls", status: s.callReporting ? "warn" : "info",
      title: s.callReporting ? "Call reporting is on in a country where Google cannot provide it" : "Phone calls are not counted natively in Serbia",
      detail: "Google forwarding numbers are not available in Serbia, so calls from ads cannot be recorded with a duration. The native signal that does work is a tap on the phone number on the site — it counts taps, not calls.",
      fix: s.callReporting ? "Switch call reporting off (Google's own advice for such countries), and add a phone-tap goal below." : "Add a phone-tap goal below if phone leads matter to this business." });
  }
  if (!enabled.some((a) => a.type === "UPLOAD_CLICKS")) {
    checks.push({ id: "offline", status: "info", title: "No lead outcomes are imported",
      detail: "Bidding cannot tell a spam enquiry from a paying job. Importing which leads became jobs — through Google's Data Manager API — is the only way to teach it the difference, and the only way to take junk back out of the signal." });
  }

  // 8. Tag Manager.
  if (client?.has_gtm) {
    const live = tags.filter((t) => !t.paused);
    const adsTags = live.filter((t) => t.type === "awct");
    if (!adsTags.length) {
      checks.push({ id: "gtm_ads", status: "warn", title: "No live Google Ads conversion tag in Tag Manager",
        detail: "Conversions may be tracked another way (the Google tag, or an Analytics import) — but if not, nothing is being recorded." });
    }
    if (adsTags.length && !live.some((t) => t.type === "gclidw")) {
      checks.push({ id: "gtm_linker", status: "bad", title: "No conversion linker in Tag Manager",
        detail: "Without it, ad clicks lose their click identifier on cross-domain and Safari journeys, and conversions that happened never get attributed.",
        fix: "Creating any goal below adds one automatically." });
    }
  } else {
    checks.push({ id: "gtm_none", status: "info", title: "Tag Manager is not connected",
      detail: "Fortress can still create conversion actions and hand you an import file, but cannot check or write the tags itself." });
  }

  // 9. Analytics cross-check.
  if (client?.has_ga4) {
    const keyEvents = Number(ga[0]?.key_events ?? 0);
    const adsConv = primary.reduce((n, a) => n + Number(a.conversions_30d ?? 0), 0);
    if (adsConv > 0 && keyEvents === 0) {
      checks.push({ id: "ga4_silent", status: "warn", title: "Analytics records no key events while Ads records conversions",
        detail: "The two should broadly agree on how many leads there are. When one is silent, one of them is wrong." });
    } else if (adsConv === 0 && keyEvents > 0) {
      checks.push({ id: "ads_silent", status: "bad", title: "Analytics records key events but Ads records no conversions",
        detail: `Analytics saw ${keyEvents.toFixed(0)} key events in 30 days. The Ads conversion tag is very likely broken.` });
    }
  }

  const order = { bad: 0, warn: 1, info: 2, ok: 3 };
  checks.sort((a, b) => order[a.status] - order[b.status]);
  return { checks, actions, settings: s };
}
