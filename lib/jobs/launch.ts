import { q } from "@/lib/db";
import { mutate, mutateAll, digits } from "@/lib/google/ads";
import { clientFor, connectionForClient } from "@/lib/google/auth";
import { clientWithProperties } from "@/lib/binding";
import { readDraft, problems } from "@/lib/builder/draft";

/**
 * Launching a drafted campaign as a resumable state machine.
 *
 *   budget → campaign (PAUSED) → locations → negatives
 *          → [ad group → keywords → ad] per group
 *          → enable
 *
 * Every step is written to launch_steps with the resource it created before
 * the next begins. A failure halfway leaves a campaign that is paused, not half
 * live, and running launch again resumes from the failed step instead of
 * creating a second budget and a second campaign.
 */

export async function launchDraft(clientId: number, draftId: number, opts: { goLive?: boolean } = { goLive: true }) {
  const [row] = await q<any>(`SELECT * FROM drafts WHERE id = $1 AND client_id = $2`, [draftId, clientId]);
  if (!row) throw new Error("No such draft.");
  if (row.status === "launched") throw new Error("This campaign has already been launched.");
  if (row.status === "paused" && opts.goLive === false) return { campaign: row.campaign_resource, steps: [] as string[] };
  const d = readDraft(row.state);
  const blocking = problems(d);
  if (blocking.length) throw new Error(`Not ready to launch: ${blocking.map((p) => p.message).join(" ")}`);

  const client = await clientWithProperties(clientId);
  if (!client?.ads_customer_id) throw new Error("No Google Ads account is bound to this client.");
  const conn = await connectionForClient(clientId);
  if (!conn) throw new Error("No Google connection.");
  const auth = await clientFor(conn.id);
  const cid = digits(client.ads_customer_id);

  const done = new Map<string, string | null>(
    (await q<any>(`SELECT step, resource_name FROM launch_steps WHERE draft_id = $1 AND status = 'done'`, [draftId]))
      .map((s) => [s.step, s.resource_name])
  );
  await q(`UPDATE drafts SET status = 'launching', updated_at = now() WHERE id = $1`, [draftId]);

  const step = async (name: string, fn: () => Promise<string | null>): Promise<string | null> => {
    if (done.has(name)) return done.get(name) ?? null;
    try {
      const rn = await fn();
      await q(`INSERT INTO launch_steps (draft_id, step, status, resource_name) VALUES ($1,$2,'done',$3)
               ON CONFLICT (draft_id, step) DO UPDATE SET status = 'done', resource_name = EXCLUDED.resource_name, error = NULL`,
        [draftId, name, rn]);
      done.set(name, rn);
      return rn;
    } catch (err) {
      await q(`INSERT INTO launch_steps (draft_id, step, status, error) VALUES ($1,$2,'failed',$3)
               ON CONFLICT (draft_id, step) DO UPDATE SET status = 'failed', error = EXCLUDED.error`,
        [draftId, name, (err as Error).message]);
      await q(`UPDATE drafts SET status = 'failed', updated_at = now() WHERE id = $1`, [draftId]);
      throw new Error(`Launch stopped at "${name}": ${(err as Error).message}. The campaign is paused; launching again resumes from here.`);
    }
  };

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");

  const budget = await step("budget", async () => {
    const [r] = await mutate(auth, cid, "campaignBudgets", [{
      create: {
        name: `${d.name} — ${stamp}`,
        amountMicros: String(Math.round(d.dailyBudget! * 1_000_000)),
        deliveryMethod: "STANDARD",
        explicitlyShared: false,
      },
    }]);
    return r.resourceName ?? null;
  });

  const campaign = await step("campaign", async () => {
    const bidding = d.bidding === "MAXIMIZE_CLICKS"
      ? { targetSpend: d.maxCpc ? { cpcBidCeilingMicros: String(Math.round(d.maxCpc * 1_000_000)) } : {} }
      // No target: on a low-volume account a target is more likely to cost
      // volume than save money, and Google itself suggests starting without one.
      : { maximizeConversions: {} };
    const [r] = await mutate(auth, cid, "campaigns", [{
      create: {
        name: d.name,
        status: "PAUSED",
        advertisingChannelType: "SEARCH",
        campaignBudget: budget,
        networkSettings: {
          targetGoogleSearch: true,
          targetSearchNetwork: false,
          targetContentNetwork: false,
          targetPartnerSearchNetwork: false,
        },
        geoTargetTypeSetting: { positiveGeoTargetType: d.presence, negativeGeoTargetType: "PRESENCE" },
        containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
        ...bidding,
      },
    }]);
    return r.resourceName ?? null;
  });

  await step("locations", async () => {
    await mutate(auth, cid, "campaignCriteria", d.locations.map((l) => ({
      create: { campaign, location: { geoTargetConstant: `geoTargetConstants/${digits(l.id)}` } },
    })));
    return null;
  });

  if (d.negatives.length) {
    await step("negatives", async () => {
      await mutate(auth, cid, "campaignCriteria", d.negatives.slice(0, 200).map((text) => ({
        create: { campaign, negative: true, keyword: { text, matchType: "PHRASE" } },
      })));
      return null;
    });
  }

  for (let i = 0; i < d.groups.length; i++) {
    const g = d.groups[i];
    const adGroup = await step(`group ${i + 1}`, async () => {
      const [r] = await mutate(auth, cid, "adGroups", [{
        create: { name: g.name, campaign, status: "ENABLED", type: "SEARCH_STANDARD" },
      }]);
      return r.resourceName ?? null;
    });
    await step(`group ${i + 1} keywords`, async () => {
      await mutate(auth, cid, "adGroupCriteria", g.keywords.filter((k) => k.text.trim()).map((k) => ({
        create: { adGroup, status: "ENABLED", keyword: { text: k.text.trim(), matchType: k.match } },
      })));
      return null;
    });
    await step(`group ${i + 1} ad`, async () => {
      const [r] = await mutate(auth, cid, "adGroupAds", [{
        create: {
          adGroup,
          status: "ENABLED",
          ad: {
            finalUrls: [g.finalUrl],
            responsiveSearchAd: {
              headlines: g.headlines.map((h) => h.trim()).filter(Boolean).slice(0, 15).map((text) => ({ text })),
              descriptions: g.descriptions.map((h) => h.trim()).filter(Boolean).slice(0, 4).map((text) => ({ text })),
              ...(g.path1 ? { path1: g.path1 } : {}),
              ...(g.path2 ? { path2: g.path2 } : {}),
            },
          },
        },
      }]);
      return r.resourceName ?? null;
    });
  }

  await q(`UPDATE drafts SET campaign_resource = $2 WHERE id = $1`, [draftId, campaign]);
  if (opts.goLive === false) {
    // Built and waiting: going live is a separate decision after the final check.
    await q(`UPDATE drafts SET status = 'paused', updated_at = now() WHERE id = $1`, [draftId]);
    return { campaign, steps: [...done.keys()] };
  }

  await step("enable", async () => {
    await mutate(auth, cid, "campaigns", [{ update: { resourceName: campaign, status: "ENABLED" }, updateMask: "status" }]);
    return campaign;
  });

  await q(`UPDATE drafts SET status = 'launched', live_at = now(), updated_at = now() WHERE id = $1`, [draftId]);
  await scheduleFollowUps(clientId, draftId, d.name);
  return { campaign, steps: [...done.keys()] };
}

/**
 * The whole campaign sent to Google as one validate-only request, linked by
 * temporary IDs: budget, campaign, places, negatives, ad groups, keywords and
 * ads are all checked — policy, limits, references — and nothing is created.
 */
export async function dryRunDraft(clientId: number, draftId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const [row] = await q<any>(`SELECT * FROM drafts WHERE id = $1 AND client_id = $2`, [draftId, clientId]);
  if (!row) throw new Error("No such draft.");
  const d = readDraft(row.state);
  const blocking = problems(d);
  if (blocking.length) return { ok: false, error: blocking.map((p) => p.message).join(" ") };
  const client = await clientWithProperties(clientId);
  if (!client?.ads_customer_id) throw new Error("No Google Ads account is bound to this project.");
  const conn = await connectionForClient(clientId);
  if (!conn) throw new Error("No Google connection.");
  const auth = await clientFor(conn.id);
  const cid = digits(client.ads_customer_id);
  const r = (type: string, id: number) => `customers/${cid}/${type}/${id}`;
  const budget = r("campaignBudgets", -1), campaign = r("campaigns", -2);
  const ops: unknown[] = [
    { campaignBudgetOperation: { create: { resourceName: budget, name: `${d.name} (check)`, amountMicros: String(Math.round(d.dailyBudget! * 1e6)), deliveryMethod: "STANDARD", explicitlyShared: false } } },
    { campaignOperation: { create: {
      resourceName: campaign, name: d.name, status: "PAUSED", advertisingChannelType: "SEARCH", campaignBudget: budget,
      networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
      geoTargetTypeSetting: { positiveGeoTargetType: d.presence, negativeGeoTargetType: "PRESENCE" },
      containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
      ...(d.bidding === "MAXIMIZE_CLICKS" ? { targetSpend: d.maxCpc ? { cpcBidCeilingMicros: String(Math.round(d.maxCpc * 1e6)) } : {} } : { maximizeConversions: {} }),
    } } },
    ...d.locations.map((l) => ({ campaignCriterionOperation: { create: { campaign, location: { geoTargetConstant: `geoTargetConstants/${digits(l.id)}` } } } })),
    ...d.negatives.slice(0, 200).map((text) => ({ campaignCriterionOperation: { create: { campaign, negative: true, keyword: { text, matchType: "PHRASE" } } } })),
  ];
  d.groups.forEach((g, i) => {
    const adGroup = r("adGroups", -(10 + i));
    ops.push({ adGroupOperation: { create: { resourceName: adGroup, name: g.name, campaign, status: "ENABLED", type: "SEARCH_STANDARD" } } });
    for (const k of g.keywords.filter((k) => k.text.trim())) {
      ops.push({ adGroupCriterionOperation: { create: { adGroup, status: "ENABLED", keyword: { text: k.text.trim(), matchType: k.match } } } });
    }
    ops.push({ adGroupAdOperation: { create: { adGroup, status: "ENABLED", ad: {
      finalUrls: [g.finalUrl],
      responsiveSearchAd: {
        headlines: g.headlines.map((h) => h.trim()).filter(Boolean).slice(0, 15).map((text) => ({ text })),
        descriptions: g.descriptions.map((h) => h.trim()).filter(Boolean).slice(0, 4).map((text) => ({ text })),
        ...(g.path1 ? { path1: g.path1 } : {}), ...(g.path2 ? { path2: g.path2 } : {}),
      },
    } } } });
  });
  try {
    await mutateAll(auth, cid, ops, { validateOnly: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** The separate decision: a campaign built paused goes live. */
export async function goLive(clientId: number, draftId: number) {
  const [row] = await q<any>(`SELECT * FROM drafts WHERE id = $1 AND client_id = $2`, [draftId, clientId]);
  if (!row) throw new Error("No such draft.");
  if (row.status !== "paused" || !row.campaign_resource) throw new Error("Only a campaign that has been built and is waiting can go live.");
  const client = await clientWithProperties(clientId);
  const conn = await connectionForClient(clientId);
  if (!client?.ads_customer_id || !conn) throw new Error("No Google connection.");
  const auth = await clientFor(conn.id);
  const cid = digits(client.ads_customer_id);
  const op = [{ update: { resourceName: row.campaign_resource, status: "ENABLED" }, updateMask: "status" }];
  await mutate(auth, cid, "campaigns", op, undefined, { validateOnly: true });
  await mutate(auth, cid, "campaigns", op);
  await q(`INSERT INTO launch_steps (draft_id, step, status, resource_name) VALUES ($1,'enable','done',$2)
           ON CONFLICT (draft_id, step) DO UPDATE SET status = 'done', resource_name = EXCLUDED.resource_name, error = NULL`, [draftId, row.campaign_resource]);
  await q(`UPDATE drafts SET status = 'launched', live_at = now(), updated_at = now() WHERE id = $1`, [draftId]);
  await scheduleFollowUps(clientId, draftId, readDraft(row.state).name);
  return { campaign: row.campaign_resource };
}

/** What to look at, and when, after a campaign goes live. */
async function scheduleFollowUps(clientId: number, draftId: number, name: string) {
  const items: [string, number, string, string, string][] = [
    ["launch_serving", 3, `Is "${name}" showing?`, "Three days in: impressions should be arriving and every ad approved. If not, the ads may be disapproved or the bid too low.", `/clients/${clientId}/ads`],
    ["launch_search_terms", 14, `Review the first searches for "${name}"`, "Two weeks of searches: add negatives for the ones that are not buyers, and keywords for any that convert.", `/clients/${clientId}/ads/search-terms`],
    ["launch_decision", 30, `Keep, fix or stop "${name}"?`, "A month in: compare the cost per lead with your target and with what the proposal expected.", `/clients/${clientId}/ads`],
  ];
  for (const [kind, days, title, detail, href] of items) {
    await q(`INSERT INTO follow_ups (client_id, draft_id, kind, title, detail, href, due_on) VALUES ($1,$2,$3,$4,$5,$6, CURRENT_DATE + $7::int)`,
      [clientId, draftId, kind, title, detail, href, days]);
  }
}
