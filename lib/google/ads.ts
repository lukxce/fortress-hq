import type { OAuth2Client } from "google-auth-library";
import { countOps } from "./quota";

// The Google Ads REST interface, called directly.
//
// Why not a client library: the Opteo package cannot authenticate with a
// service account at all, and this app commits to both auth paths working
// interchangeably (see ARCHITECTURE-V2 §4.8). REST also removes the enum
// decoding gotcha — over REST, protobuf JSON mapping returns enums as their
// NAME ("ENABLED"), not the integer gRPC returns.
//
// Two mapping rules that bite:
//   1. GAQL is snake_case; JSON responses are lowerCamelCase.
//      SELECT campaign.advertising_channel_type  →  campaign.advertisingChannelType
//   2. int64 fields arrive as JSON STRINGS. costMicros is "1234560", not 1234560.

export const ADS_VERSION = "v25";
const BASE = `https://googleads.googleapis.com/${ADS_VERSION}`;

export const digits = (id: string | number | null | undefined) =>
  String(id ?? "").replace(/\D/g, "");

export class AdsError extends Error {
  constructor(
    message: string,
    public status: number,
    public errorCode?: string,
    public raw?: unknown
  ) {
    super(message);
    this.name = "AdsError";
  }
}

async function headers(client: OAuth2Client, loginCustomerId?: string) {
  const { token } = await client.getAccessToken();
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  // Developer tokens were sunset 9 Sep 2026: access level now comes from the
  // Cloud project behind the credential. The header is accepted but ignored,
  // so it is only sent if explicitly configured.
  if (process.env.ADS_DEVELOPER_TOKEN) h["developer-token"] = process.env.ADS_DEVELOPER_TOKEN;
  if (loginCustomerId) h["login-customer-id"] = digits(loginCustomerId);
  return h;
}

async function call(
  client: OAuth2Client,
  path: string,
  init: { method?: string; body?: unknown; loginCustomerId?: string } = {}
): Promise<unknown> {
  const res = await fetch(`${BASE}/${path}`, {
    method: init.method ?? "GET",
    headers: await headers(client, init.loginCustomerId),
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  // Failed calls still consume daily quota.
  await countOps("ads", 1, !res.ok);

  if (!res.ok) {
    const first = Array.isArray(data) ? (data as unknown[])[0] : data;
    const err = (first as { error?: { message?: string; details?: unknown[] } })?.error;
    const detail = (err?.details?.[0] as { errors?: { message?: string; errorCode?: object }[] })
      ?.errors?.[0];
    const code = detail?.errorCode ? String(Object.values(detail.errorCode)[0]) : undefined;
    throw new AdsError(
      detail?.message ?? err?.message ?? `HTTP ${res.status}`,
      res.status,
      code,
      data
    );
  }
  return data;
}

/** Accounts this credential has DIRECT access to — never the whole tree. */
export async function listAccessibleCustomers(client: OAuth2Client): Promise<string[]> {
  const out = (await call(client, "customers:listAccessibleCustomers")) as {
    resourceNames?: string[];
  };
  return (out.resourceNames ?? []).map((rn) => rn.split("/")[1]);
}

export type AdsRow = Record<string, any>;

/**
 * searchStream over REST. The body is a JSON ARRAY of chunk objects, each
 * { results, fieldMask, requestId } — not newline-delimited JSON.
 */
export async function searchStream(
  client: OAuth2Client,
  customerId: string,
  query: string,
  loginCustomerId?: string
): Promise<AdsRow[]> {
  const chunks = (await call(client, `customers/${digits(customerId)}/googleAds:searchStream`, {
    method: "POST",
    loginCustomerId,
    body: { query: query.trim() },
  })) as { results?: AdsRow[] }[] | null;

  const rows: AdsRow[] = [];
  for (const chunk of chunks ?? []) for (const r of chunk.results ?? []) rows.push(r);
  return rows;
}

export type AdsAccount = {
  id: string;
  name: string;
  isManager: boolean;
  currency: string | null;
  timezone: string | null;
  status: string | null;
  parentId: string;
};

/**
 * The full tree under one accessible root. listAccessibleCustomers returns
 * direct grants only, so the hierarchy has to come from customer_client with
 * login-customer-id set to the root.
 */
export async function customerTree(
  client: OAuth2Client,
  rootId: string
): Promise<AdsAccount[]> {
  const rows = await searchStream(
    client,
    rootId,
    `SELECT customer_client.id,
            customer_client.descriptive_name,
            customer_client.manager,
            customer_client.currency_code,
            customer_client.time_zone,
            customer_client.status
       FROM customer_client
      WHERE customer_client.status != 'CANCELED'`,
    rootId
  );

  return rows.map((r) => {
    const c = r.customerClient ?? {};
    return {
      id: digits(c.id),
      name: c.descriptiveName ?? "",
      isManager: Boolean(c.manager),
      currency: c.currencyCode ?? null,
      timezone: c.timeZone ?? null,
      status: c.status ?? null,
      parentId: digits(rootId),
    };
  });
}

/**
 * Ads exposes no domain field, so it is derived from the most common
 * registrable domain across recent campaign final URLs. Costs one operation
 * per account and is what makes auto-binding to GA4/GSC possible.
 */
export async function guessDomain(
  client: OAuth2Client,
  customerId: string,
  loginCustomerId?: string
): Promise<string | null> {
  try {
    const rows = await searchStream(
      client,
      customerId,
      `SELECT ad_group_ad.ad.final_urls
         FROM ad_group_ad
        WHERE ad_group_ad.status != 'REMOVED'
        LIMIT 200`,
      loginCustomerId
    );

    const tally = new Map<string, number>();
    for (const r of rows) {
      for (const url of r.adGroupAd?.ad?.finalUrls ?? []) {
        try {
          const host = new URL(url).hostname.replace(/^www\./, "");
          tally.set(host, (tally.get(host) ?? 0) + 1);
        } catch { /* a malformed final URL is not worth failing over */ }
      }
    }
    if (!tally.size) return null;
    return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
  } catch {
    return null;   // an account we can list but not read is not fatal
  }
}

/**
 * A write against one of the mutate services.
 *
 * Same envelope as searchStream — REST, lowerCamelCase JSON, int64 as strings.
 * `MUTABLE_RESOURCE` asks Google to return the created object rather than only
 * its resource name, which saves a round trip for every field except
 * tag_snippets: those are generated after the fact and only ever appear on a
 * read.
 *
 * Mutates are not idempotent and there is no request key here, so a caller that
 * retries on timeout can create the same object twice. Check before you create.
 */
export async function mutate(
  client: OAuth2Client,
  customerId: string,
  service: string,
  operations: unknown[],
  loginCustomerId?: string
): Promise<{ resourceName?: string; [k: string]: unknown }[]> {
  const out = (await call(client, `customers/${digits(customerId)}/${service}:mutate`, {
    method: "POST",
    loginCustomerId,
    body: { operations, responseContentType: "MUTABLE_RESOURCE" },
  })) as { results?: { resourceName?: string }[] } | null;
  return out?.results ?? [];
}

/**
 * A POST to any other Ads service method — for the handful of calls that are
 * neither a search nor a mutate, such as location suggestions.
 */
export async function adsPost(client: OAuth2Client, path: string, body: unknown, loginCustomerId?: string): Promise<any> {
  return call(client, path, { method: "POST", body, loginCustomerId });
}
