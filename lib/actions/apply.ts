import { createHmac, timingSafeEqual } from "node:crypto";
import { q } from "@/lib/db";
import { mutate, searchStream, digits } from "@/lib/google/ads";
import { clientFor, connectionForClient } from "@/lib/google/auth";
import { clientWithProperties } from "@/lib/binding";
import { validateAction, type Action } from "./kinds";
import { fullWeekSchedule } from "./schedule";
import { startExperiment } from "@/lib/jobs/evaluate";

/**
 * Making a change in Google Ads.
 *
 * Two calls, never one. Preview re-validates the action against the live
 * account and returns the summary that names the change and the money, plus a
 * token signed over exactly that action. Apply only accepts the action that
 * token was issued for — so what the operator confirmed is what runs, even if
 * the page was open for an hour and the recommendation was rewritten meanwhile.
 */

const DEVICE_CRITERION: Record<string, string> = { DESKTOP: "30000", MOBILE: "30001", TABLET: "30002" };

function sign(clientId: number, action: Action): string {
  const key = process.env.ENCRYPTION_KEY?.trim();
  if (!key) throw new Error("ENCRYPTION_KEY is not set");
  return createHmac("sha256", key).update(`${clientId}:${stable(action)}`).digest("base64url");
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export async function previewAction(clientId: number, raw: unknown) {
  const v = await validateAction(clientId, raw);
  if (!v.ok) return v;
  return { ...v, token: sign(clientId, v.action) };
}

export async function applyAction(opts: {
  clientId: number;
  userId: number | null;
  action: Action;
  token: string;
  recommendationId?: number | null;
}) {
  const { clientId, action } = opts;
  const expected = sign(clientId, action);
  const a = Buffer.from(expected), b = Buffer.from(opts.token ?? "");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("This confirmation no longer matches the change. Reopen it and confirm again.");
  }

  // Validate once more at the moment of applying: the account may have changed.
  const v = await validateAction(clientId, action);
  if (!v.ok) throw new Error(v.reason);
  if (stable(v.action) !== stable(action)) {
    throw new Error("The account changed since this was confirmed. Reopen it and confirm again.");
  }

  const client = await clientWithProperties(clientId);
  if (!client?.ads_customer_id) throw new Error("No Google Ads account is bound to this client.");
  const conn = await connectionForClient(clientId);
  if (!conn) throw new Error("No Google connection.");
  const auth = await clientFor(conn.id);
  const cid = digits(client.ads_customer_id);
  const p = v.action.params;
  const campaign = `customers/${cid}/campaigns/${p.campaign_id}`;

  let result: unknown;
  try {
    switch (v.action.kind) {
      case "pause_campaign":
        result = await mutate(auth, cid, "campaigns", [
          { update: { resourceName: campaign, status: "PAUSED" }, updateMask: "status" },
        ]);
        await q(`UPDATE campaigns SET status = 'PAUSED' WHERE client_id = $1 AND campaign_id = $2`, [clientId, p.campaign_id]);
        break;

      case "add_negative_keywords":
        result = await mutate(auth, cid, "campaignCriteria", (p.terms as string[]).map((text) => ({
          create: { campaign, negative: true, keyword: { text, matchType: p.match_type } },
        })));
        for (const text of p.terms as string[]) {
          await q(`INSERT INTO negatives (client_id, ads_customer_id, level, campaign_id, text, match_type)
                   VALUES ($1,$2,'campaign',$3,$4,$5) ON CONFLICT DO NOTHING`,
            [clientId, cid, p.campaign_id, text.toLowerCase(), p.match_type]);
        }
        break;

      case "change_budget":
        result = await mutate(auth, cid, "campaignBudgets", [
          { update: { resourceName: p.budget_resource_name, amountMicros: p.new_micros }, updateMask: "amountMicros" },
        ]);
        await q(`UPDATE campaigns SET budget_micros = $3 WHERE client_id = $1 AND budget_resource_name = $2`,
          [clientId, p.budget_resource_name, p.new_micros]);
        break;

      case "set_ad_schedule": {
        // Replace, never add: an existing schedule plus a new band would leave
        // hours covered twice or not at all.
        const existing = await searchStream(auth, cid, `
          SELECT campaign_criterion.resource_name FROM campaign_criterion
           WHERE campaign.id = ${digits(p.campaign_id)} AND campaign_criterion.type = 'AD_SCHEDULE'`);
        const entries = fullWeekSchedule(p as any);
        const ops = [
          ...existing.map((r) => ({ remove: r.campaignCriterion.resourceName })),
          ...entries.map((e) => ({
            create: {
              campaign,
              adSchedule: { dayOfWeek: e.day, startHour: e.startHour, startMinute: "ZERO", endHour: e.endHour, endMinute: "ZERO" },
              ...(p.mode === "adjust" ? { bidModifier: e.bidModifier } : {}),
            },
          })),
        ];
        result = await mutate(auth, cid, "campaignCriteria", ops);
        break;
      }

      case "set_device_bid_modifier": {
        const criterion = DEVICE_CRITERION[p.device];
        const bidModifier = Math.round((1 + p.bid_adjust_pct / 100) * 100) / 100;
        try {
          result = await mutate(auth, cid, "campaignCriteria", [{
            update: { resourceName: `customers/${cid}/campaignCriteria/${p.campaign_id}~${criterion}`, bidModifier },
            updateMask: "bidModifier",
          }]);
        } catch {
          // Not every campaign carries a device criterion until one is set.
          result = await mutate(auth, cid, "campaignCriteria", [{
            create: { campaign, device: { type: p.device }, bidModifier },
          }]);
        }
        break;
      }
    }
  } catch (err) {
    await log(opts, v.summary, "failed", (err as Error).message, null);
    throw err;
  }

  const logId = await log(opts, v.summary, "applied", null, result);

  // A recommendation carried out by its button is done, and if it predicted
  // something, its experiment starts now — with the baseline taken today.
  if (opts.recommendationId) {
    await q(`UPDATE recommendations SET status = 'done', updated_at = now() WHERE id = $1 AND client_id = $2`,
      [opts.recommendationId, clientId]);
    const [exp] = await q<{ id: number }>(`SELECT id FROM experiments WHERE recommendation_id = $1 AND status = 'proposed'`,
      [opts.recommendationId]);
    if (exp) {
      await startExperiment(clientId, exp.id, "button", v.campaignIds);
      await q(`UPDATE action_log SET experiment_id = $1 WHERE id = $2`, [exp.id, logId]);
    }
  }

  return { summary: v.summary, warnings: v.warnings };
}

async function log(
  opts: { clientId: number; userId: number | null; action: Action; recommendationId?: number | null },
  summary: string, status: "applied" | "failed", error: string | null, result: unknown
): Promise<number> {
  const [r] = await q<{ id: number }>(
    `INSERT INTO action_log (client_id, user_id, recommendation_id, kind, params, summary, status, error, result)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [opts.clientId, opts.userId, opts.recommendationId ?? null, opts.action.kind,
     JSON.stringify(opts.action.params), summary, status, error, result ? JSON.stringify(result) : null]
  );
  return r.id;
}
