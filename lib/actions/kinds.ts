import { z } from "zod";
import { q } from "@/lib/db";
import { fromMicros } from "@/lib/engine/metrics";
import { blocksOrVariant, brandTerms, containsBrand, normalise } from "@/lib/engine/brand";

/**
 * The five changes Fortress can make by itself. Anything else stays written
 * instructions.
 *
 * Every action is validated twice against the live account: once when the
 * brain proposes it (an invalid proposal loses its button, never the whole
 * recommendation) and again at the moment of applying (the account may have
 * changed since). Validation returns the action as it will actually be applied,
 * plus a plain-language summary that names the change and the money, which is
 * what the confirmation dialog shows.
 */

export const ACTION_KINDS = [
  "pause_campaign",
  "add_negative_keywords",
  "change_budget",
  "set_ad_schedule",
  "set_device_bid_modifier",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type Action = { kind: ActionKind; params: Record<string, any> };

export type Validated =
  | { ok: true; action: Action; summary: string; warnings: string[]; campaignIds: string[] }
  | { ok: false; reason: string };

const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;

const schemas = {
  pause_campaign: z.object({ campaign_id: z.string() }),
  add_negative_keywords: z.object({
    campaign_id: z.string(),
    terms: z.array(z.string()).min(1).max(50),
    match_type: z.enum(["EXACT", "PHRASE"]).default("EXACT"),
  }),
  change_budget: z.object({
    campaign_id: z.string(),
    change_pct: z.number().int().min(-30).max(30),
  }),
  set_ad_schedule: z.object({
    campaign_id: z.string(),
    // A contiguous band of hours, end exclusive, may wrap midnight.
    start_hour: z.number().int().min(0).max(23),
    end_hour: z.number().int().min(0).max(24),
    days: z.array(z.enum(DAYS)).default([...DAYS]),
    // "exclude" stops ads in the band. "adjust" lowers or raises bids there, and
    // only exists where the bid strategy honours schedule adjustments.
    mode: z.enum(["exclude", "adjust"]),
    bid_adjust_pct: z.number().int().min(-90).max(100).optional(),
  }),
  set_device_bid_modifier: z.object({
    campaign_id: z.string(),
    device: z.enum(["MOBILE", "DESKTOP", "TABLET"]),
    bid_adjust_pct: z.number().int().min(-100).max(100),
  }),
} satisfies Record<ActionKind, z.ZodTypeAny>;

/** Strategies under which ad-schedule and device adjustments are honoured in full. */
const ADJUSTMENTS_HONOURED = /^(MANUAL_CPC|TARGET_SPEND|MAXIMIZE_CLICKS)$/;

async function campaign(clientId: number, id: string) {
  const [c] = await q<any>(`
    SELECT c.campaign_id, c.name, c.status, c.channel_type, c.bidding_strategy,
           c.budget_micros, c.budget_shared, c.budget_resource_name, cl.currency
      FROM campaigns c JOIN clients cl ON cl.id = c.client_id
     WHERE c.client_id = $1 AND c.campaign_id = $2`, [clientId, id]);
  return c ?? null;
}

const fmt = (n: number, currency: string | null) =>
  `${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}${currency ? ` ${currency}` : ""}`;

export async function validateAction(clientId: number, raw: unknown): Promise<Validated> {
  const kind = (raw as any)?.kind;
  if (!ACTION_KINDS.includes(kind)) return { ok: false, reason: `Unknown action "${kind}".` };
  const parsed = (schemas as any)[kind].safeParse((raw as any).params ?? {});
  if (!parsed.success) return { ok: false, reason: `Invalid parameters for ${kind}.` };
  const p = parsed.data;

  const c = await campaign(clientId, String(p.campaign_id));
  if (!c) return { ok: false, reason: "That campaign is not in this account." };
  if (c.status === "REMOVED") return { ok: false, reason: "That campaign has been removed." };
  const warnings: string[] = [];

  // 30-day spend, so a confirmation can name the money involved.
  const [s] = await q<any>(`SELECT COALESCE(SUM(cost_micros),0) AS cost FROM metrics_daily
     WHERE client_id = $1 AND entity_type = 'campaign' AND entity_id = $2 AND date > CURRENT_DATE - 31`, [clientId, c.campaign_id]);
  const spend30 = fromMicros(s?.cost);

  switch (kind as ActionKind) {
    case "pause_campaign": {
      if (c.status !== "ENABLED") return { ok: false, reason: `${c.name} is not running.` };
      return {
        ok: true, action: { kind, params: p }, campaignIds: [c.campaign_id], warnings,
        summary: `Pause "${c.name}". It spent ${fmt(spend30, c.currency)} in the last 30 days.`,
      };
    }

    case "add_negative_keywords": {
      if (c.channel_type === "PERFORMANCE_MAX") {
        return { ok: false, reason: "Campaign-level negatives cannot be added to Performance Max this way." };
      }
      const [brands, converting, existing, waste] = await Promise.all([
        brandTerms(clientId),
        q<{ term: string }>(`SELECT DISTINCT term FROM search_terms WHERE client_id = $1 AND conversions > 0
                              UNION SELECT DISTINCT text FROM keywords WHERE client_id = $1 AND conversions > 0`, [clientId]),
        q<{ text: string }>(`SELECT DISTINCT text FROM negatives WHERE client_id = $1
                               AND (campaign_id = $2 OR level = 'shared')`, [clientId, c.campaign_id]),
        q<{ term: string }>(`SELECT DISTINCT term FROM search_terms WHERE client_id = $1 AND conversions = 0`, [clientId]),
      ]);
      const wasteSet = new Set(waste.map((w) => normalise(w.term)));
      const have = new Set(existing.map((e) => normalise(e.text)));
      const kept: string[] = [];
      const refused: string[] = [];
      for (const t of p.terms as string[]) {
        const n = normalise(t);
        // The three hard rules. Breaking any of them causes damage money cannot fix.
        if (containsBrand(t, brands)) { refused.push(`"${t}" contains a brand word`); continue; }
        const variant = converting.find((cv) => blocksOrVariant(t, cv.term));
        if (variant) { refused.push(`"${t}" would block the converting search "${variant.term}"`); continue; }
        if (!wasteSet.has(n)) { refused.push(`"${t}" is not a non-converting search in this account`); continue; }
        if (have.has(n)) { refused.push(`"${t}" is already a negative`); continue; }
        if (!kept.includes(t)) kept.push(t);
      }
      if (!kept.length) return { ok: false, reason: refused.join("; ") || "No valid negatives left." };
      if (refused.length) warnings.push(`Left out: ${refused.join("; ")}.`);
      const [ws] = await q<any>(`SELECT COALESCE(SUM(cost_micros),0) AS cost FROM search_terms
         WHERE client_id = $1 AND lower(term) = ANY($2)`, [clientId, kept.map((k) => k.toLowerCase())]);
      return {
        ok: true, action: { kind, params: { ...p, terms: kept } }, campaignIds: [c.campaign_id], warnings,
        summary: `Add ${kept.length} ${p.match_type.toLowerCase()}-match negative${kept.length === 1 ? "" : "s"} to "${c.name}". Those searches cost ${fmt(fromMicros(ws?.cost), c.currency)} over 90 days with no conversions.`,
      };
    }

    case "change_budget": {
      if (!c.budget_micros || !c.budget_resource_name) return { ok: false, reason: "The campaign's budget could not be read." };
      if (c.budget_shared) warnings.push("This budget is shared, so the change affects every campaign using it.");
      if (p.change_pct === 0) return { ok: false, reason: "No change." };
      const now = fromMicros(c.budget_micros);
      // Round to a whole currency unit; Google rejects amounts that are not a
      // multiple of the currency's minimum unit.
      const next = Math.max(1, Math.round(now * (1 + p.change_pct / 100)));
      return {
        ok: true,
        action: { kind, params: { ...p, current_micros: String(c.budget_micros), new_micros: String(next * 1_000_000), budget_resource_name: c.budget_resource_name } },
        campaignIds: [c.campaign_id], warnings,
        summary: `Change the daily budget of "${c.name}" from ${fmt(now, c.currency)} to ${fmt(next, c.currency)} (${p.change_pct > 0 ? "+" : ""}${p.change_pct}%). About ${fmt((next - now) * 30.4, c.currency)} a month ${next > now ? "more" : "less"} at full delivery.`,
      };
    }

    case "set_ad_schedule": {
      if (p.start_hour === p.end_hour % 24) return { ok: false, reason: "The band is empty." };
      if (p.mode === "adjust") {
        if (!ADJUSTMENTS_HONOURED.test(c.bidding_strategy ?? "")) {
          return { ok: false, reason: `${c.name} uses ${c.bidding_strategy}, which ignores ad-schedule bid adjustments. Only excluding the hours works.` };
        }
        if (p.bid_adjust_pct == null || p.bid_adjust_pct === 0) return { ok: false, reason: "An adjustment needs a percentage." };
      }
      const band = `${String(p.start_hour).padStart(2, "0")}:00–${String(p.end_hour % 24).padStart(2, "0")}:00`;
      const days = p.days.length === 7 ? "every day" : p.days.map((d: string) => d.slice(0, 3).toLowerCase()).join(", ");
      return {
        ok: true, action: { kind, params: p }, campaignIds: [c.campaign_id], warnings,
        summary: p.mode === "exclude"
          ? `Stop "${c.name}" showing ads between ${band}, ${days}. The rest of the week is written out explicitly so the campaign cannot go dark. It spent ${fmt(spend30, c.currency)} in the last 30 days in total.`
          : `Adjust bids on "${c.name}" by ${p.bid_adjust_pct > 0 ? "+" : ""}${p.bid_adjust_pct}% between ${band}, ${days}, leaving every other hour at normal bids.`,
      };
    }

    case "set_device_bid_modifier": {
      const full = ADJUSTMENTS_HONOURED.test(c.bidding_strategy ?? "") || c.bidding_strategy === "TARGET_CPA";
      if (!full && p.bid_adjust_pct !== -100) {
        return { ok: false, reason: `${c.name} uses ${c.bidding_strategy}, which only honours a device adjustment of −100% (switching the device off).` };
      }
      if (c.channel_type === "PERFORMANCE_MAX") return { ok: false, reason: "Performance Max does not take device adjustments." };
      return {
        ok: true, action: { kind, params: p }, campaignIds: [c.campaign_id], warnings,
        summary: p.bid_adjust_pct === -100
          ? `Stop "${c.name}" showing on ${p.device.toLowerCase()}.`
          : `Adjust bids on ${p.device.toLowerCase()} for "${c.name}" by ${p.bid_adjust_pct > 0 ? "+" : ""}${p.bid_adjust_pct}%.`,
      };
    }
  }
}
