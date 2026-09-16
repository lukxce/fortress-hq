import { q } from "@/lib/db";
import { mutate, digits } from "@/lib/google/ads";
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

export async function launchDraft(clientId: number, draftId: number) {
  const [row] = await q<any>(`SELECT * FROM drafts WHERE id = $1 AND client_id = $2`, [draftId, clientId]);
  if (!row) throw new Error("No such draft.");
  if (row.status === "launched") throw new Error("This campaign has already been launched.");
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

  await step("enable", async () => {
    await mutate(auth, cid, "campaigns", [{ update: { resourceName: campaign, status: "ENABLED" }, updateMask: "status" }]);
    return campaign;
  });

  await q(`UPDATE drafts SET status = 'launched', updated_at = now() WHERE id = $1`, [draftId]);
  return { campaign, steps: [...done.keys()] };
}
