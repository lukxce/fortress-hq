import { q, tx } from "@/lib/db";
import { clientWithProperties, type ClientWithProps } from "@/lib/binding";
import { campaignPerformance, periodTotals, pacing, fromMicros } from "./metrics";

export type Finding = {
  kind: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
  moneyAtStake?: number;
  entityType?: string;
  entityId?: string;
};

// Volume gates. Below these, a ratio is noise dressed as a signal: three clicks
// and no conversion says nothing at all. Every rule that divides respects one.
const MIN_CLICKS = 100;
const MIN_SPEND = 50;
const MIN_CONVERSIONS = 5;

export async function computeFindings(clientId: number): Promise<Finding[]> {
  const client = await clientWithProperties(clientId);
  if (!client) return [];

  const out: Finding[] = [];
  const campaigns = await campaignPerformance(clientId, 30);
  const { current, previous } = await periodTotals(clientId, 30);
  const pace = await pacing(client);

  out.push(...budgetFindings(pace, client));
  out.push(...healthFindings(campaigns));
  out.push(...(await wasteFindings(clientId)));
  out.push(...efficiencyFindings(campaigns, client, current));
  out.push(...trendFindings(current, previous));
  out.push(...(await trackingFindings(clientId, client, current)));
  out.push(...(await overlapFindings(clientId, client)));

  return out.sort((a, b) => {
    const rank = { critical: 0, warning: 1, info: 2 };
    if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
    return (b.moneyAtStake ?? 0) - (a.moneyAtStake ?? 0);
  });
}

// --------------------------------------------------------------- budget ----

function budgetFindings(p: ReturnType<typeof pacing> extends Promise<infer T> ? T : never, c: ClientWithProps): Finding[] {
  const out: Finding[] = [];
  if (p.monthlyBudget && p.variancePct !== null && p.daysElapsed >= 5) {
    const over = p.variancePct > 12;
    const under = p.variancePct < -12;
    if (over || under) {
      const diff = Math.abs(p.projected - p.monthlyBudget);
      out.push({
        kind: over ? "pacing_over" : "pacing_under",
        severity: over ? "warning" : "info",
        title: over
          ? `Projected to overspend by ${money(diff, c.currency)}`
          : `Projected to underspend by ${money(diff, c.currency)}`,
        detail: over
          ? `At the current daily rate of ${money(p.dailyAverage, c.currency)} the month lands at ${money(p.projected, c.currency)} against a budget of ${money(p.monthlyBudget, c.currency)}.`
          : `Spend is running below plan. At ${money(p.dailyAverage, c.currency)} a day the month lands at ${money(p.projected, c.currency)} against ${money(p.monthlyBudget, c.currency)}, so there is room to buy more volume.`,
        evidence: {
          monthSpend: p.monthSpend, projected: p.projected,
          budget: p.monthlyBudget, dailyAverage: p.dailyAverage,
          daysElapsed: p.daysElapsed, daysInMonth: p.daysInMonth,
        },
        moneyAtStake: diff,
      });
    }
  }
  return out;
}

// --------------------------------------------------------------- health ----

function healthFindings(campaigns: Awaited<ReturnType<typeof campaignPerformance>>): Finding[] {
  const out: Finding[] = [];
  for (const c of campaigns) {
    const reasons = c.primary_status_reasons ?? [];
    if (!reasons.length) continue;

    // Google's own diagnosis, which is the cheapest and most reliable signal
    // available and costs nothing extra to read.
    const serious = reasons.filter((r) =>
      /REMOVED|PAUSED_BY|MISCONFIGURED|PENDING|ENDED|BUDGET_CONSTRAINED|LIMITED_BY_BUDGET|AD_GROUPS_PAUSED|NO_ADS|ADS_DISAPPROVED|KEYWORDS_PAUSED|LOW_QUALITY/i.test(r)
    );
    if (!serious.length) continue;

    const budgetLimited = serious.some((r) => /BUDGET/i.test(r));
    const disapproved = serious.some((r) => /DISAPPROVED/i.test(r));

    out.push({
      kind: budgetLimited ? "budget_limited" : disapproved ? "ads_disapproved" : "campaign_misconfigured",
      severity: disapproved ? "critical" : budgetLimited ? "warning" : "warning",
      title: disapproved
        ? `Ads disapproved in ${c.name}`
        : budgetLimited
          ? `${c.name} is limited by budget`
          : `${c.name} needs attention`,
      detail: disapproved
        ? "Disapproved ads do not serve. Everything spent on this campaign is buying less reach than it should."
        : budgetLimited
          ? `Google reports this campaign is constrained by its budget, so it is losing impressions it would otherwise win. It spent ${c.spend.toFixed(2)} in the last 30 days.`
          : `Google reports: ${serious.join(", ").toLowerCase().replace(/_/g, " ")}.`,
      evidence: { primaryStatus: c.primary_status, reasons: serious, spend30d: c.spend },
      entityType: "campaign",
      entityId: c.campaign_id,
    });
  }
  return out;
}

// ---------------------------------------------------------------- waste ----

async function wasteFindings(clientId: number): Promise<Finding[]> {
  const rows = await q<{
    total_cost: string; term_count: string; top_terms: any;
  }>(`
    WITH wasteful AS (
      SELECT term, cost_micros, clicks
        FROM search_terms
       WHERE client_id = $1 AND conversions = 0 AND cost_micros > 2000000
    )
    SELECT COALESCE(SUM(cost_micros),0) AS total_cost,
           COUNT(*) AS term_count,
           COALESCE(json_agg(json_build_object('term', term, 'cost', cost_micros/1e6, 'clicks', clicks)
                    ORDER BY cost_micros DESC) FILTER (WHERE term IS NOT NULL), '[]') AS top_terms
      FROM wasteful
  `, [clientId]);

  const r = rows[0];
  const wasted = fromMicros(r?.total_cost);
  const count = Number(r?.term_count ?? 0);
  if (wasted < MIN_SPEND || count === 0) return [];

  const [totals] = await q<{ cost_micros: string }>(`
    SELECT COALESCE(SUM(cost_micros),0) AS cost_micros FROM metrics_daily
     WHERE client_id = $1 AND entity_type = 'campaign'
       AND date > CURRENT_DATE - 91 AND date <= CURRENT_DATE - 1
  `, [clientId]);
  const total = fromMicros(totals?.cost_micros);
  const share = total > 0 ? (wasted / total) * 100 : 0;

  const top = (Array.isArray(r?.top_terms) ? r.top_terms : []).slice(0, 8);

  return [{
    kind: "search_term_waste",
    severity: share > 20 ? "critical" : "warning",
    title: `${wasted.toFixed(0)} spent on search terms that never converted`,
    detail: `${count} search terms took spend and produced no conversions over the last 90 days, which is ${share.toFixed(0)}% of total spend. The largest is "${top[0]?.term ?? ""}" at ${Number(top[0]?.cost ?? 0).toFixed(2)}. These are negative keyword candidates.`,
    evidence: { wasted, termCount: count, shareOfSpend: share, topTerms: top },
    moneyAtStake: wasted,
  }];
}

// ----------------------------------------------------------- efficiency ----

function efficiencyFindings(
  campaigns: Awaited<ReturnType<typeof campaignPerformance>>,
  client: ClientWithProps,
  overall: { cpa: number | null; roas: number | null; spend: number }
): Finding[] {
  const out: Finding[] = [];
  const goal = client.goal_type;
  const targetCpa = client.target_cpa ? Number(client.target_cpa) : null;
  const targetRoas = client.target_roas ? Number(client.target_roas) : null;

  // Account level against the operator's own target. No target means no
  // judgement is possible, and inventing a benchmark would be worse than
  // staying quiet.
  if (goal === "cpa" && targetCpa && overall.cpa !== null && overall.spend >= MIN_SPEND) {
    const over = ((overall.cpa - targetCpa) / targetCpa) * 100;
    if (over > 15) {
      out.push({
        kind: "cpa_above_target",
        severity: over > 50 ? "critical" : "warning",
        title: `Cost per conversion is ${over.toFixed(0)}% above target`,
        detail: `Thirty-day cost per conversion is ${overall.cpa.toFixed(2)} against a target of ${targetCpa.toFixed(2)}.`,
        evidence: { cpa: overall.cpa, target: targetCpa, overBy: over },
        moneyAtStake: overall.spend * (over / 100) / (1 + over / 100),
      });
    }
  }
  if (goal === "roas" && targetRoas && overall.roas !== null && overall.spend >= MIN_SPEND) {
    const under = ((targetRoas - overall.roas) / targetRoas) * 100;
    if (under > 15) {
      out.push({
        kind: "roas_below_target",
        severity: under > 40 ? "critical" : "warning",
        title: `Return on ad spend is ${under.toFixed(0)}% below target`,
        detail: `Thirty-day return is ${overall.roas.toFixed(2)}x against a target of ${targetRoas.toFixed(2)}x.`,
        evidence: { roas: overall.roas, target: targetRoas, underBy: under },
        moneyAtStake: overall.spend * (under / 100),
      });
    }
  }

  // Campaign level: spending with nothing to show for it.
  for (const c of campaigns) {
    if (c.spend < MIN_SPEND || c.clicks < MIN_CLICKS) continue;
    if (c.conversions === 0) {
      out.push({
        kind: "campaign_no_conversions",
        severity: "critical",
        title: `${c.name} spent ${c.spend.toFixed(0)} with no conversions`,
        detail: `${c.clicks} clicks over 30 days and nothing recorded. Either the campaign genuinely is not working, or its conversion tracking is broken — check tracking before pausing.`,
        evidence: { spend: c.spend, clicks: c.clicks, impressions: c.impressions },
        moneyAtStake: c.spend,
        entityType: "campaign",
        entityId: c.campaign_id,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------- trend ----

function trendFindings(cur: any, prev: any): Finding[] {
  const out: Finding[] = [];
  if (prev.spend < MIN_SPEND || cur.spend < MIN_SPEND) return out;

  if (cur.cpa !== null && prev.cpa !== null && prev.conversions >= MIN_CONVERSIONS) {
    const change = ((cur.cpa - prev.cpa) / prev.cpa) * 100;
    if (change > 25) {
      out.push({
        kind: "cpa_rising",
        severity: "warning",
        title: `Cost per conversion rose ${change.toFixed(0)}% versus the previous 30 days`,
        detail: `It moved from ${prev.cpa.toFixed(2)} to ${cur.cpa.toFixed(2)} while spend went from ${prev.spend.toFixed(0)} to ${cur.spend.toFixed(0)}.`,
        evidence: { current: cur.cpa, previous: prev.cpa, changePct: change },
        moneyAtStake: (cur.cpa - prev.cpa) * cur.conversions,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------- tracking ----

async function trackingFindings(
  clientId: number, client: ClientWithProps, cur: any
): Promise<Finding[]> {
  const out: Finding[] = [];

  // Conversion-action hygiene. These distort the number everything else is
  // judged on, so they matter more than anything downstream of them.
  const actions = await q<any>(
    `SELECT * FROM conversion_actions WHERE client_id = $1 AND status = 'ENABLED'`,
    [clientId]
  );

  const LEAD = /SUBMIT_LEAD_FORM|SIGNUP|BOOK_APPOINTMENT|REQUEST_QUOTE|CONTACT|PHONE_CALL/i;
  for (const a of actions) {
    if (!a.include_in_conversions) continue;
    if (LEAD.test(a.category ?? "") && a.counting_type === "MANY_PER_CLICK") {
      out.push({
        kind: "conversion_multi_counting",
        severity: "critical",
        title: `"${a.name}" counts every submission from the same click`,
        detail: `A lead action set to count many per click inflates the conversion number: one person submitting twice reads as two leads. Set it to one per click, or every cost-per-conversion figure above is understated.`,
        evidence: { action: a.name, category: a.category, counting: a.counting_type },
        entityType: "conversion_action",
        entityId: a.action_id,
      });
    }
    if (/PAGE_VIEW|ENGAGEMENT|DEFAULT/i.test(a.category ?? "")) {
      out.push({
        kind: "micro_conversion_counted",
        severity: "warning",
        title: `"${a.name}" is counted as a conversion`,
        detail: `This looks like a page view or engagement rather than a real outcome. Counting it in Conversions makes bidding optimise toward it and flatters every efficiency figure.`,
        evidence: { action: a.name, category: a.category },
        entityType: "conversion_action",
        entityId: a.action_id,
      });
    }
    if (a.include_in_conversions && Number(a.conversions_30d) === 0) {
      out.push({
        kind: "conversion_action_silent",
        severity: "warning",
        title: `"${a.name}" has recorded nothing in 30 days`,
        detail: `The action is enabled and counted but has no volume. Either it is genuinely unused, or the tag stopped firing.`,
        evidence: { action: a.name, volume30d: 0 },
        entityType: "conversion_action",
        entityId: a.action_id,
      });
    }
  }

  // The cross-product check that is the whole reason for pulling Analytics.
  if (client.ga4_property_id) {
    const [ga] = await q<{ key_events: string; sessions: string }>(`
      SELECT COALESCE(SUM(key_events),0) AS key_events,
             COALESCE(SUM(sessions),0) AS sessions
        FROM ga4_daily
       WHERE client_id = $1 AND date > CURRENT_DATE - 31 AND date <= CURRENT_DATE - 1
    `, [clientId]);

    const keyEvents = Number(ga?.key_events ?? 0);
    const sessions = Number(ga?.sessions ?? 0);

    if (cur.spend >= MIN_SPEND && cur.conversions === 0 && keyEvents > 0) {
      out.push({
        kind: "ads_tracking_broken",
        severity: "critical",
        title: "Analytics records conversions but Google Ads does not",
        detail: `Analytics logged ${keyEvents.toFixed(0)} key events over 30 days while Ads recorded none, on ${cur.spend.toFixed(0)} of spend. Demand is there; the Ads conversion tag or the import is broken. Every efficiency number is meaningless until this is fixed.`,
        evidence: { adsConversions: 0, ga4KeyEvents: keyEvents, spend: cur.spend },
        moneyAtStake: cur.spend,
      });
    } else if (cur.spend >= MIN_SPEND && cur.conversions === 0 && keyEvents === 0 && sessions > 0) {
      out.push({
        kind: "tracking_silent_everywhere",
        severity: "critical",
        title: "Neither Ads nor Analytics recorded a single conversion",
        detail: `${sessions.toFixed(0)} sessions and ${cur.spend.toFixed(0)} spent over 30 days with nothing recorded anywhere. Traffic is arriving, so this is measurement, not demand.`,
        evidence: { sessions, spend: cur.spend },
        moneyAtStake: cur.spend,
      });
    }
  }

  return out;
}

// --------------------------------------------------------------- overlap ---

async function overlapFindings(clientId: number, client: ClientWithProps): Promise<Finding[]> {
  if (!client.gsc_site_url) return [];

  // Queries the site already wins organically, that Ads is also paying for.
  // Correlational, not proof — position and paid clicks are measured
  // separately — so it is surfaced as information, never as an instruction.
  const rows = await q<any>(`
    WITH organic AS (
      SELECT query, AVG(position) AS pos, SUM(clicks) AS clicks
        FROM gsc_daily
       WHERE client_id = $1 AND date > CURRENT_DATE - 31
       GROUP BY query
      HAVING AVG(position) <= 3.5 AND SUM(clicks) >= 10
    )
    SELECT o.query, o.pos, o.clicks AS organic_clicks,
           s.cost_micros, s.conversions
      FROM organic o
      JOIN search_terms s ON lower(s.term) = lower(o.query) AND s.client_id = $1
     WHERE s.cost_micros > 1000000
     ORDER BY s.cost_micros DESC
     LIMIT 15
  `, [clientId]);

  if (!rows.length) return [];
  const spend = rows.reduce((n, r) => n + fromMicros(r.cost_micros), 0);
  if (spend < MIN_SPEND) return [];

  return [{
    kind: "paid_organic_overlap",
    severity: "info",
    title: `${spend.toFixed(0)} spent on queries you already rank top-three for`,
    detail: `${rows.length} queries take paid clicks while the site sits in the top three organically. Sometimes that is deliberate — owning the page, or defending against a competitor — but it is worth deciding rather than inheriting.`,
    evidence: {
      spend,
      queries: rows.slice(0, 10).map((r) => ({
        query: r.query,
        position: Number(r.pos).toFixed(1),
        organicClicks: Number(r.organic_clicks),
        paidSpend: fromMicros(r.cost_micros),
        conversions: Number(r.conversions),
      })),
    },
    moneyAtStake: spend,
  }];
}

// ----------------------------------------------------------------- store ---

export async function storeFindings(clientId: number, findings: Finding[]): Promise<void> {
  await tx(async (run) => {
    for (const f of findings) {
      await run(
        `INSERT INTO findings (client_id, kind, severity, title, detail, evidence,
            money_at_stake_micros, entity_type, entity_id, last_seen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
         ON CONFLICT (client_id, kind, entity_type, entity_id) DO UPDATE SET
           severity = EXCLUDED.severity, title = EXCLUDED.title,
           detail = EXCLUDED.detail, evidence = EXCLUDED.evidence,
           money_at_stake_micros = EXCLUDED.money_at_stake_micros,
           last_seen = now(),
           status = CASE WHEN findings.status = 'resolved' THEN 'open' ELSE findings.status END`,
        [clientId, f.kind, f.severity, f.title, f.detail, JSON.stringify(f.evidence),
         f.moneyAtStake != null ? String(Math.round(f.moneyAtStake * 1e6)) : null,
         f.entityType ?? "", f.entityId ?? ""]
      );
    }
    // Anything that stopped being true is resolved, not deleted, so the history
    // of what was wrong survives.
    await run(
      `UPDATE findings SET status = 'resolved'
        WHERE client_id = $1 AND status = 'open' AND last_seen < now() - interval '1 minute'`,
      [clientId]
    );
  });
}

function money(n: number, currency: string | null): string {
  return `${n.toFixed(0)} ${currency ?? ""}`.trim();
}
