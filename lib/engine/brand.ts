import { q } from "@/lib/db";

/**
 * Brand protection and the close-variant guard.
 *
 * Brand traffic is the cheapest in most accounts, and a negative on it cannot be
 * undone by spending more — the searcher simply never sees the ad. So brand
 * words are pulled from the business's own name up front, and anything
 * containing one is removed from every waste finding before the model sees it,
 * and refused by the negative-keyword action.
 *
 * The same normalisation drives the second guard: a term that converts, or any
 * close variant of it, is never proposed as a negative.
 */

/** Lowercase, strip diacritics (č→c, š→s, đ→dj), collapse whitespace. */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Words that appear in business names but describe the trade or the place, not
// the business. "Klima Servis Niš" is a service-plus-city phrase, not a brand:
// treating "klima" as brand would shield every generic query from waste checks.
const GENERIC = new Set([
  // Serbian trades and services
  "klima", "klime", "servis", "servisi", "moler", "molerski", "elektro", "elektricar",
  "vodoinstalater", "grejanje", "ciscenje", "stomatolog", "stomatoloska", "ordinacija",
  "keramika", "pločice", "plocice", "prodaja", "montaza", "ugradnja", "popravka",
  "izolacija", "isusivanje", "vlage", "zubar", "salon", "centar", "studio", "shop",
  "prodavnica", "gradjevina", "firma", "usluge", "servisa", "doo", "pr", "sztr", "str",
  // English
  "cleaning", "clean", "service", "services", "plumbing", "plumber", "electric",
  "electrician", "dental", "dentist", "clinic", "group", "company", "the", "and",
  "llc", "inc", "ltd", "pro", "best", "home", "house", "account", "active", "ads",
  "campaign", "google", "new", "old", "main", "official",
  // Places
  "nis", "beograd", "belgrade", "novi", "sad", "srbija", "serbia", "kragujevac",
  "subotica", "jacksonville", "florida", "fl", "usa",
]);

/** Candidate brand words from names and a domain. */
export function deriveBrandTerms(names: (string | null | undefined)[], domain?: string | null): string[] {
  const out = new Set<string>();
  for (const name of names) {
    if (!name) continue;
    for (const token of normalise(name).split(" ")) {
      if (token.length >= 4 && !GENERIC.has(token) && !/^\d+$/.test(token)) out.add(token);
    }
  }
  if (domain) {
    const host = domain.replace(/^[a-z]+:\/\//i, "").replace(/^sc-domain:/, "").replace(/^www\./, "").split("/")[0];
    const label = normalise(host.split(".")[0] ?? "").replace(/\s/g, "");
    if (label.length >= 4) {
      // A domain made only of generic words ("klimaservisnis") is not a brand.
      const stripped = [...GENERIC].reduce((s, g) => s.split(g).join(""), label);
      if (stripped.replace(/\d/g, "").length >= 3) out.add(label);
    }
  }
  return [...out];
}

/** The client's brand terms: whatever the operator set, else derived. */
export async function brandTerms(clientId: number): Promise<string[]> {
  const [row] = await q<{ brand_terms: string[]; name: string; website: string | null; names: string[] | null; domains: string[] | null }>(`
    SELECT c.brand_terms, c.name, c.website,
           array_agg(DISTINCT i.display_name) FILTER (WHERE i.display_name IS NOT NULL) AS names,
           array_agg(DISTINCT COALESCE(i.domain, CASE WHEN i.provider = 'gsc' THEN i.provider_id END))
             FILTER (WHERE i.domain IS NOT NULL OR i.provider = 'gsc') AS domains
      FROM clients c
      LEFT JOIN client_properties cp ON cp.client_id = c.id
      LEFT JOIN inventory i ON i.id = cp.inventory_id
     WHERE c.id = $1
     GROUP BY c.id
  `, [clientId]);
  if (!row) return [];
  if (row.brand_terms?.length) return row.brand_terms.map(normalise).filter(Boolean);
  const derived = new Set<string>();
  for (const t of deriveBrandTerms([row.name, ...(row.names ?? [])], row.website)) derived.add(t);
  for (const d of row.domains ?? []) for (const t of deriveBrandTerms([], d)) derived.add(t);
  return [...derived];
}

/** True if the text contains any brand word, on word boundaries or fused ("optimal25com"). */
export function containsBrand(text: string, brands: string[]): boolean {
  if (!brands.length) return false;
  const n = normalise(text);
  const fused = n.replace(/\s/g, "");
  return brands.some((b) => {
    const nb = normalise(b);
    if (!nb) return false;
    return new RegExp(`(^|\\s)${escape(nb)}`).test(n) || fused.includes(nb.replace(/\s/g, ""));
  });
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A crude stem: good enough to catch plurals and Serbian case endings. */
function stem(token: string): string {
  if (token.length <= 4) return token;
  return token.replace(/(ima|ama|ovi|eva|ova|om|em|og|ih|im|es|s|a|e|i|u|o)$/, "");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Would a negative on `negative` block, or is it a close variant of, `converting`?
 *
 * True when the normalised texts match, when their stemmed word sets match in
 * any order, when one is within two edits of the other, or when every word of
 * the negative appears in the converting term — because a phrase or broad
 * negative on those words would block it.
 */
export function blocksOrVariant(negative: string, converting: string): boolean {
  const a = normalise(negative), b = normalise(converting);
  if (!a || !b) return false;
  if (a === b) return true;
  const sa = a.split(" ").map(stem), sb = b.split(" ").map(stem);
  if ([...sa].sort().join(" ") === [...sb].sort().join(" ")) return true;
  if (Math.min(a.length, b.length) >= 5 && levenshtein(a, b) <= 2) return true;
  const setB = new Set(sb);
  return sa.every((t) => setB.has(t));
}
