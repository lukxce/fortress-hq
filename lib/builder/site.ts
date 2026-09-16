import Anthropic from "@anthropic-ai/sdk";
import { q } from "@/lib/db";

/**
 * Step 1 of the builder: read the business's own website and distil what it
 * sells, to whom, and where.
 *
 * Only the homepage and a handful of same-site pages are fetched — enough to
 * name the services, not a crawl. The distillation is the one creative step:
 * everything it produces is shown back to the operator to correct.
 */

const MAX_PAGES = 8;
const UA = "Mozilla/5.0 (compatible; FortressHQ/1.0; +https://www.fortress-hq.com)";

type Page = { url: string; title: string; text: string };

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) return null;
    return { html: (await res.text()).slice(0, 600_000), finalUrl: res.url };
  } catch {
    return null;
  }
}

function textOf(html: string): { title: string; text: string } {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] ?? "";
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(br|\/p|\/h\d|\/li|\/div)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#?\w+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return { title, text: `${desc}\n${body}`.slice(0, 5000) };
}

function sameSiteLinks(html: string, base: string): string[] {
  const host = new URL(base).host;
  const out = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], base);
      if (u.host !== host || !/^https?:$/.test(u.protocol)) continue;
      if (/\.(pdf|jpe?g|png|webp|svg|zip)$/i.test(u.pathname)) continue;
      if (/(privacy|cookie|terms|login|cart|korpa|nalog|wp-admin|feed)/i.test(u.pathname)) continue;
      u.search = ""; u.hash = "";
      out.add(u.toString());
    } catch { /* not a URL */ }
  }
  return [...out];
}

export async function readSite(rawUrl: string): Promise<Page[]> {
  const start = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const home = await fetchPage(start);
  if (!home) throw new Error(`Could not open ${start}.`);
  const pages: Page[] = [{ url: home.finalUrl, ...textOf(home.html) }];
  // Prefer short paths: /usluge/servis-klima is a service page; a blog post is not.
  const links = sameSiteLinks(home.html, home.finalUrl)
    .filter((l) => l.replace(/\/$/, "") !== home.finalUrl.replace(/\/$/, ""))
    .sort((a, b) => new URL(a).pathname.split("/").length - new URL(b).pathname.split("/").length)
    .slice(0, MAX_PAGES - 1);
  const fetched = await Promise.all(links.map((l) => fetchPage(l)));
  fetched.forEach((f, i) => { if (f) pages.push({ url: f.finalUrl ?? links[i], ...textOf(f.html) }); });
  return pages;
}

export type SiteSummary = {
  business: string;
  offers: { name: string; url: string }[];
  audience: string;
  places: string[];
  phone: string | null;
  language: string;
  sellingPoints: string[];
};

export async function distil(clientId: number, url: string): Promise<SiteSummary> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set.");
  const pages = await readSite(url);

  const anthropic = new Anthropic({ apiKey: key });
  const schema = {
    type: "object",
    properties: {
      business: { type: "string" },
      offers: { type: "array", items: { type: "object", properties: { name: { type: "string" }, url: { type: "string" } }, required: ["name", "url"], additionalProperties: false } },
      audience: { type: "string" },
      places: { type: "array", items: { type: "string" } },
      phone: { type: "string" },
      language: { type: "string" },
      sellingPoints: { type: "array", items: { type: "string" } },
    },
    required: ["business", "offers", "audience", "places", "phone", "language", "sellingPoints"],
    additionalProperties: false,
  };
  const res = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 2000,
    system: "You read a small business's website and say, in plain words, what it sells, to whom and where. Only state what the pages say — never invent a service, a place, a price or a phone number. offers: each distinct service or product line, with the URL of the page that best describes it (one of the URLs given). places: towns or areas served, as written on the site. phone: as written, or an empty string. language: the site's language (for example \"Serbian (Latin)\"). sellingPoints: short factual claims the site makes (years in business, guarantees, response times) — at most six.",
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: JSON.stringify(pages) }],
  } as any);
  const text = (res.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const summary = JSON.parse(text) as SiteSummary;
  summary.phone = summary.phone || null;

  await q(`INSERT INTO site_summaries (client_id, url, summary, crawled_at) VALUES ($1,$2,$3, now())
           ON CONFLICT (client_id) DO UPDATE SET url = EXCLUDED.url, summary = EXCLUDED.summary, crawled_at = now()`,
    [clientId, url, JSON.stringify(summary)]);
  await q(`UPDATE clients SET website = COALESCE(website, $2) WHERE id = $1`, [clientId, url]);
  return summary;
}
