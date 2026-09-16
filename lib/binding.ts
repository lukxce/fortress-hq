import { q, q1, tx } from "@/lib/db";
import { currentUser, visibleClients, visibleConnections } from "@/lib/user";

export type InventoryItem = {
  id: number;
  provider: "ads" | "ga4" | "gsc" | "gtm";
  provider_id: string;
  display_name: string;
  domain: string | null;
  currency: string | null;
  timezone: string | null;
};

export type Suggestion = {
  provider: "ga4" | "gsc" | "gtm";
  inventory_id: number;
  label: string;
  reason: string;
  confidence: "high" | "low";
};

/**
 * Suggest which property, site and container belong with an Ads account.
 *
 * Matching is by domain, which every product exposes differently: Search
 * Console gives it directly, GA4 gives it via the web data stream, Ads has no
 * domain field at all so it is inferred from campaign final URLs, and Tag
 * Manager gives nothing usable — so containers fall back to name similarity.
 *
 * Suggestions are never applied silently. A wrong binding makes the conversion
 * cross-check compare two unrelated businesses, which is worse than no binding.
 */
export async function suggestBindings(adsInventoryId: number): Promise<Suggestion[]> {
  const me = await currentUser();
  const scope = visibleConnections(me?.id ?? null, 2);
  const ads = await q1<InventoryItem>(`SELECT * FROM inventory WHERE id = $1 AND ${scope}`, me ? [adsInventoryId, me.id] : [adsInventoryId]);
  if (!ads) return [];

  const others = await q<InventoryItem>(
    `SELECT * FROM inventory
      WHERE provider <> 'ads' AND status <> 'revoked' AND ${visibleConnections(me?.id ?? null, 1)}`,
    me ? [me.id] : []
  );

  const out: Suggestion[] = [];
  const adsDomain = normalise(ads.domain);
  const adsName = ads.display_name.toLowerCase();

  for (const provider of ["ga4", "gsc", "gtm"] as const) {
    const candidates = others.filter((o) => o.provider === provider);
    if (!candidates.length) continue;

    let best: { item: InventoryItem; reason: string; confidence: "high" | "low" } | null = null;

    if (adsDomain) {
      // Tag Manager exposes no domain, but containers are usually named after the site.
      const host = (c: InventoryItem) => normalise(c.domain) ?? normalise(c.display_name.replace(/^https?:\/\//i, "").split("/")[0]);
      const exact = candidates.find((c) => host(c) === adsDomain);
      if (exact) best = { item: exact, reason: `Same domain (${adsDomain})`, confidence: "high" };
      if (!best) {
        // "dotconsortium.com" against a container called "DOT Consortium".
        const label = adsDomain.split(".")[0].replace(/[^a-z0-9]/g, "");
        const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
        const named = label.length >= 5 ? candidates.find((c) => squash(c.display_name).includes(label) || squash(c.domain ?? "").includes(label)) : undefined;
        if (named) best = { item: named, reason: `Named after ${adsDomain} — check this one`, confidence: "low" };
      }
    }

    if (!best) {
      // Fall back to name overlap. Deliberately marked low confidence: two
      // clients in the same trade often share most of their words.
      const scored = candidates
        .map((c) => ({ c, score: nameOverlap(adsName, c.display_name.toLowerCase()) }))
        .filter((x) => x.score >= 0.5)
        .sort((a, b) => b.score - a.score);
      if (scored.length) {
        best = { item: scored[0].c, reason: "Similar name — check this one", confidence: "low" };
      }
    }

    if (best) {
      out.push({
        provider,
        inventory_id: best.item.id,
        label: best.item.display_name || best.item.provider_id,
        reason: best.reason,
        confidence: best.confidence,
      });
    }
  }

  return out;
}

function normalise(domain: string | null): string | null {
  if (!domain) return null;
  return domain.toLowerCase().replace(/^www\./, "").trim() || null;
}

/** Share of the shorter name's words that appear in the longer one. */
function nameOverlap(a: string, b: string): number {
  const words = (s: string) =>
    s.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
  const wa = words(a);
  const wb = words(b);
  if (!wa.length || !wb.length) return 0;
  const setB = new Set(wb);
  const hits = wa.filter((w) => setB.has(w)).length;
  return hits / Math.min(wa.length, wb.length);
}

const STOP = new Set(["the", "and", "ltd", "llc", "inc", "com", "doo", "dooel", "google", "ads", "account"]);

/**
 * Create a client from a selected Ads account and whatever else is bound to it.
 * The goal and target come from the operator: no API can tell us whether an
 * account is judged on cost per acquisition or on return on ad spend.
 */
export async function createClient(input: {
  name: string;
  adsInventoryId: number;
  goalType: "cpa" | "roas";
  targetCpa?: number | null;
  targetRoas?: number | null;
  monthlyBudget?: number | null;
  bindings: { provider: "ga4" | "gsc" | "gtm"; inventory_id: number; bound_by: "auto" | "confirmed" | "manual" }[];
}): Promise<number> {
  const me = await currentUser();
  const scope = visibleConnections(me?.id ?? null, 2);
  const ads = await q1<InventoryItem>(`SELECT * FROM inventory WHERE id = $1 AND ${scope}`, me ? [input.adsInventoryId, me.id] : [input.adsInventoryId]);
  if (!ads) throw new Error("That Ads account is no longer in the inventory.");
  // Every binding must be reachable by the person creating the project.
  for (const b of input.bindings) {
    const ok = await q1(`SELECT 1 FROM inventory WHERE id = $1 AND ${scope}`, me ? [b.inventory_id, me.id] : [b.inventory_id]);
    if (!ok) throw new Error("One of the chosen properties is not reachable from your Google connection.");
  }

  // A client belongs to whoever created it; others see it only if shared.
  const owner = me?.id ?? null;

  return tx(async (run) => {
    const [client] = await run<{ id: number }>(
      `INSERT INTO clients (name, goal_type, target_cpa, target_roas, monthly_budget, currency, timezone, owner_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        input.name.trim(),
        input.goalType,
        input.goalType === "cpa" ? input.targetCpa ?? null : null,
        input.goalType === "roas" ? input.targetRoas ?? null : null,
        input.monthlyBudget ?? null,
        ads.currency,
        ads.timezone,
        owner,
      ]
    );

    await run(
      `INSERT INTO client_properties (client_id, provider, inventory_id, bound_by)
       VALUES ($1, 'ads', $2, 'manual')`,
      [client.id, input.adsInventoryId]
    );
    await run("UPDATE inventory SET status = 'selected' WHERE id = $1", [input.adsInventoryId]);

    for (const b of input.bindings) {
      await run(
        `INSERT INTO client_properties (client_id, provider, inventory_id, bound_by)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (client_id, provider) DO UPDATE
           SET inventory_id = EXCLUDED.inventory_id, bound_by = EXCLUDED.bound_by`,
        [client.id, b.provider, b.inventory_id, b.bound_by]
      );
      await run("UPDATE inventory SET status = 'selected' WHERE id = $1", [b.inventory_id]);
    }

    return client.id;
  });
}

export type ClientRow = {
  id: number;
  name: string;
  goal_type: "cpa" | "roas" | null;
  target_cpa: string | null;
  target_roas: string | null;
  monthly_budget: string | null;
  currency: string | null;
  timezone: string | null;
  website: string | null;
  brand_terms: string[];
  ads_settings: Record<string, any>;
  owner_id: number | null;
};

export type ClientWithProps = ClientRow & {
  ads_customer_id: string | null;
  ga4_property_id: string | null;
  gsc_site_url: string | null;
  gtm_container_id: string | null;
};

/** A client plus the provider ids the sync job needs. */
/**
 * Every client the signed-in user may see, with the provider ids bound to it.
 *
 * Scoped rather than global: a second user must not be handed another
 * operator's accounts just because they share an installation. Background jobs
 * that legitimately run for nobody pass a user id explicitly.
 */
export async function clientsWithProperties(
  forUserId?: number | null
): Promise<ClientWithProps[]> {
  const userId = forUserId !== undefined ? forUserId : (await currentUser())?.id ?? null;
  const scope = visibleClients(userId, 1);
  return q<ClientWithProps>(`
    SELECT c.*,
           MAX(i.provider_id) FILTER (WHERE i.provider = 'ads') AS ads_customer_id,
           MAX(i.provider_id) FILTER (WHERE i.provider = 'ga4') AS ga4_property_id,
           MAX(i.provider_id) FILTER (WHERE i.provider = 'gsc') AS gsc_site_url,
           MAX(i.provider_id) FILTER (WHERE i.provider = 'gtm') AS gtm_container_id
      FROM clients c
      LEFT JOIN client_properties cp ON cp.client_id = c.id
      LEFT JOIN inventory i ON i.id = cp.inventory_id
     WHERE NOT c.archived AND ${scope}
     GROUP BY c.id
     ORDER BY c.name
  `, userId == null ? [] : [userId]);
}

export async function clientWithProperties(
  id: number,
  forUserId?: number | null
): Promise<ClientWithProps | null> {
  const all = await clientsWithProperties(forUserId);
  return all.find((c) => c.id === id) ?? null;
}
