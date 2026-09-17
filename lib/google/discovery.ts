import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { q, tx } from "@/lib/db";
import { clientFor } from "./auth";
import { listAccessibleCustomers, customerTree, guessDomain, digits } from "./ads";
import { countOps, gtmPace } from "./quota";

export type Provider = "ads" | "ga4" | "gsc" | "gtm" | "gbp";

/**
 * Run an async map with a concurrency cap.
 *
 * Discovery is dominated by round trips to Google, not by work. Doing them one
 * at a time meant eight accounts cost eight sequential waits, which is what
 * pushed a run past the serverless timeout.
 */
async function pMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Wall-clock budget for one discovery run, kept under the platform timeout. */
const BUDGET_MS = 45_000;

class Deadline {
  private readonly end = Date.now() + BUDGET_MS;
  get expired() { return Date.now() > this.end; }
  get remaining() { return Math.max(0, this.end - Date.now()); }
}

export type Discovered = {
  provider: Provider;
  providerId: string;
  displayName: string;
  domain?: string | null;
  parentId?: string | null;
  parentName?: string | null;
  isManager?: boolean;
  currency?: string | null;
  timezone?: string | null;
  extra?: Record<string, unknown>;
};

export type DiscoveryReport = {
  found: Record<Provider, number>;
  errors: { provider: Provider; message: string }[];
};

// --- Google Ads -------------------------------------------------------------

async function discoverAds(
  client: OAuth2Client,
  deriveDomains: boolean,
  deadline: Deadline
): Promise<Discovered[]> {
  const roots = await listAccessibleCustomers(client);
  const seen = new Map<string, Discovered>();

  for (const root of roots) {
    let tree;
    try {
      tree = await customerTree(client, root);
    } catch {
      continue;   // a cancelled or inaccessible root skips, never aborts the sweep
    }
    for (const acc of tree) {
      if (!acc.id || seen.has(acc.id)) continue;
      seen.set(acc.id, {
        provider: "ads",
        providerId: acc.id,
        displayName: acc.name || `Account ${acc.id}`,
        parentId: acc.parentId,
        isManager: acc.isManager,
        currency: acc.currency,
        timezone: acc.timezone,
        extra: { status: acc.status },
      });
    }
  }

  // Domain derivation costs one round trip per spendable account. It is the
  // only way to auto-bind an Ads account to a GA4 property or Search Console
  // site, since Ads exposes no domain field — but it is enrichment, not the
  // point, so it runs concurrently and is abandoned if time runs short. A run
  // that returns accounts without domains beats one that times out.
  const items = [...seen.values()];
  if (deriveDomains && !deadline.expired) {
    const spendable = items.filter((i) => !i.isManager);
    await pMap(spendable, 6, async (item) => {
      if (deadline.expired) return;
      item.domain = await guessDomain(client, item.providerId, item.parentId ?? undefined);
    });
  }

  return items;
}

// --- GA4 --------------------------------------------------------------------

async function discoverGa4(auth: OAuth2Client, deadline: Deadline): Promise<Discovered[]> {
  const admin = google.analyticsadmin({ version: "v1beta", auth });
  const res = await admin.accountSummaries.list({ pageSize: 200 });
  await countOps("ga4", 1);

  const out: Discovered[] = [];
  for (const acc of res.data.accountSummaries ?? []) {
    for (const p of acc.propertySummaries ?? []) {
      out.push({
        provider: "ga4",
        providerId: (p.property ?? "").replace("properties/", ""),
        displayName: p.displayName ?? "",
        parentId: (acc.account ?? "").replace("accounts/", ""),
        parentName: acc.displayName ?? null,
        extra: { propertyType: p.propertyType ?? null },
      });
    }
  }

  // The web data stream carries the site URL, which is how a GA4 property gets
  // a domain to match on. One round trip per property, so run them together.
  if (!deadline.expired) {
    await pMap(out, 6, async (item) => {
      if (deadline.expired) return;
      try {
        const streams = await admin.properties.dataStreams.list({
          parent: `properties/${item.providerId}`,
          pageSize: 20,
        });
        await countOps("ga4", 1);
        const web = (streams.data.dataStreams ?? []).find((s) => s.webStreamData?.defaultUri);
        const uri = web?.webStreamData?.defaultUri;
        if (uri) item.domain = new URL(uri).hostname.replace(/^www\./, "");
      } catch { /* a property without a readable stream still belongs in the list */ }
    });
  }

  return out;
}

// --- Business Profile -------------------------------------------------------

/**
 * Every business location the account manages. Only asked for when the
 * connection was granted Business Profile access — and Google must also have
 * approved the Cloud project for these APIs, or every call answers with a
 * quota of zero.
 */
async function discoverGbp(auth: OAuth2Client): Promise<Discovered[]> {
  const accounts = google.mybusinessaccountmanagement({ version: "v1", auth });
  const info = google.mybusinessbusinessinformation({ version: "v1", auth });
  const out: Discovered[] = [];
  let pageToken: string | undefined;
  const all: any[] = [];
  do {
    const res = await accounts.accounts.list({ pageSize: 20, pageToken });
    await countOps("gbp", 1);
    all.push(...(res.data.accounts ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  for (const a of all) {
    let token: string | undefined;
    do {
      const res = await info.accounts.locations.list({
        parent: a.name, pageSize: 100, pageToken: token,
        readMask: "name,title,storefrontAddress,websiteUri,phoneNumbers,categories,metadata",
      });
      await countOps("gbp", 1);
      for (const l of res.data.locations ?? []) {
        let domain: string | null = null;
        try { domain = l.websiteUri ? new URL(l.websiteUri).hostname.replace(/^www\./, "") : null; } catch { domain = null; }
        const addr = l.storefrontAddress;
        out.push({
          provider: "gbp",
          providerId: String(l.name),
          displayName: l.title ?? String(l.name),
          domain,
          parentId: a.name ?? null,
          parentName: a.accountName ?? null,
          extra: {
            address: addr ? [...(addr.addressLines ?? []), addr.locality].filter(Boolean).join(", ") : null,
            phone: l.phoneNumbers?.primaryPhone ?? null,
            category: l.categories?.primaryCategory?.displayName ?? null,
            mapsUri: l.metadata?.mapsUri ?? null,
            placeId: l.metadata?.placeId ?? null,
            website: l.websiteUri ?? null,
          },
        });
      }
      token = res.data.nextPageToken ?? undefined;
    } while (token);
  }
  return out;
}

// --- Search Console ---------------------------------------------------------

async function discoverGsc(auth: OAuth2Client): Promise<Discovered[]> {
  const sc = google.searchconsole({ version: "v1", auth });
  const res = await sc.sites.list({});
  await countOps("gsc", 1);

  return (res.data.siteEntry ?? []).map((s) => {
    const url = s.siteUrl ?? "";
    let domain: string | null = null;
    if (url.startsWith("sc-domain:")) domain = url.slice(10);
    else { try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { domain = null; } }

    return {
      provider: "gsc" as const,
      providerId: url,
      displayName: url,
      domain,
      extra: { permission: s.permissionLevel ?? null },
    };
  });
}

// --- Tag Manager ------------------------------------------------------------

async function discoverGtm(auth: OAuth2Client, deadline: Deadline): Promise<Discovered[]> {
  const gtm = google.tagmanager({ version: "v2", auth });
  const accounts = await gtm.accounts.list({});
  await countOps("gtm", 1);

  const out: Discovered[] = [];
  for (const a of accounts.data.account ?? []) {
    // Tag Manager cannot be parallelised: 25 requests per 100 seconds per
    // project is a hard ceiling, so this one stays paced and simply stops when
    // the budget runs out. Re-running discovery picks up where it left off.
    if (deadline.expired) break;
    try {
      const cl = await gtm.accounts.containers.list({ parent: `accounts/${a.accountId}` });
      await countOps("gtm", 1);
      for (const c of cl.data.container ?? []) {
        out.push({
          provider: "gtm",
          providerId: String(c.containerId),
          displayName: c.name ?? String(c.publicId),
          parentId: String(a.accountId),
          parentName: a.name ?? null,
          extra: {
            publicId: c.publicId ?? null,
            usageContext: c.usageContext ?? [],
            path: c.path ?? null,
          },
        });
      }
      // 25 requests per 100 seconds per project. Walk, don't run.
      await gtmPace();
    } catch { /* an account we can list but not read is not fatal */ }
  }
  return out;
}

// --- orchestration ----------------------------------------------------------

export async function runDiscovery(
  connectionId: number,
  opts: { deriveDomains?: boolean } = {}
): Promise<DiscoveryReport> {
  const client = await clientFor(connectionId);
  const deadline = new Deadline();
  const found: Record<Provider, number> = { ads: 0, ga4: 0, gsc: 0, gtm: 0, gbp: 0 };
  const [conn] = await q<{ scopes: string[] }>(`SELECT scopes FROM connections WHERE id = $1`, [connectionId]);
  const hasBusiness = (conn?.scopes ?? []).includes("https://www.googleapis.com/auth/business.manage");
  const errors: DiscoveryReport["errors"] = [];
  const all: Discovered[] = [];

  const jobs: [Provider, () => Promise<Discovered[]>][] = [
    ["ads", () => discoverAds(client, opts.deriveDomains ?? true, deadline)],
    ["ga4", () => discoverGa4(client, deadline)],
    ["gsc", () => discoverGsc(client)],
    ["gtm", () => discoverGtm(client, deadline)],
    ...(hasBusiness ? [["gbp", () => discoverGbp(client)] as [Provider, () => Promise<Discovered[]>]] : []),
  ];

  // The four products are independent, so waiting for each in turn wasted the
  // whole budget on whichever was slowest. One failing provider must not take
  // the others down, hence allSettled.
  const settled = await Promise.allSettled(jobs.map(([, fn]) => fn()));
  settled.forEach((res, i) => {
    const provider = jobs[i][0];
    if (res.status === "fulfilled") {
      found[provider] = res.value.length;
      all.push(...res.value);
    } else {
      errors.push({
        provider,
        message: (res.reason as Error)?.message ?? String(res.reason),
      });
    }
  });

  await persist(connectionId, all, Object.keys(found).filter(
    (p) => !errors.some((e) => e.provider === p)
  ) as Provider[]);

  return { found, errors };
}

/**
 * Upsert on (connection_id, provider, provider_id). A row that stops appearing is marked
 * revoked rather than deleted, so historical metrics keep their parent.
 * Only providers that actually succeeded get their absent rows revoked —
 * otherwise one failed API call would wipe out a whole product's inventory.
 */
async function persist(
  connectionId: number,
  items: Discovered[],
  succeededProviders: Provider[]
): Promise<void> {
  await tx(async (run) => {
    for (const it of items) {
      await run(
        `INSERT INTO inventory
           (connection_id, provider, provider_id, display_name, domain,
            parent_id, parent_name, is_manager, currency, timezone, extra, last_seen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
         ON CONFLICT (connection_id, provider, provider_id) DO UPDATE SET
           display_name  = EXCLUDED.display_name,
           domain        = COALESCE(EXCLUDED.domain, inventory.domain),
           parent_id     = EXCLUDED.parent_id,
           parent_name   = EXCLUDED.parent_name,
           is_manager    = EXCLUDED.is_manager,
           currency      = COALESCE(EXCLUDED.currency, inventory.currency),
           timezone      = COALESCE(EXCLUDED.timezone, inventory.timezone),
           extra         = EXCLUDED.extra,
           last_seen     = now(),
           -- a row that comes back after being revoked becomes available again,
           -- but an already-selected row stays selected
           status        = CASE WHEN inventory.status = 'revoked' THEN 'available'
                                ELSE inventory.status END`,
        [
          connectionId, it.provider, it.providerId, it.displayName, it.domain ?? null,
          it.parentId ?? null, it.parentName ?? null, it.isManager ?? false,
          it.currency ?? null, it.timezone ?? null, JSON.stringify(it.extra ?? {}),
        ]
      );
    }

    for (const provider of succeededProviders) {
      await run(
        `UPDATE inventory SET status = 'revoked'
          WHERE provider = $1 AND connection_id = $2
            AND last_seen < now() - interval '1 minute'
            AND status <> 'revoked'`,
        // Only this connection's rows. Without the connection filter, one
        // person running discovery revoked every other person's accounts.
        [provider, connectionId]
      );
    }
  });
}
