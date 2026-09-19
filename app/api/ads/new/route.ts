import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { q } from "@/lib/db";
import { mutate, digits } from "@/lib/google/ads";
import { clientFor, connectionForClient } from "@/lib/google/auth";
import { currentUser } from "@/lib/user";
import { body, failure, scopedClient } from "@/lib/api";

export const runtime = "nodejs";

const Input = z.object({
  client: z.number().int(), adGroupId: z.string().regex(/^\d+$/), finalUrl: z.string().url(),
  headlines: z.array(z.string().trim().min(1).max(30)).min(3).max(15),
  descriptions: z.array(z.string().trim().min(1).max(90)).min(2).max(4),
  path1: z.string().max(15).default(""), path2: z.string().max(15).default(""),
  confirm: z.literal(true),
});

/**
 * A new responsive search ad beside the existing ones — never an edit in
 * place, so the old ad's history survives and the two can be compared.
 * Checked by Google first; the undo pauses it.
 */
export async function POST(req: NextRequest) {
  const parsed = Input.safeParse(await body(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the ad text." }, { status: 400 });
  const a = parsed.data;
  const client = await scopedClient(a.client);
  if (client instanceof NextResponse) return client;
  try {
    const conn = await connectionForClient(client.id);
    if (!client.ads_customer_id || !conn) throw new Error("No Google connection.");
    const auth = await clientFor(conn.id);
    const cid = digits(client.ads_customer_id);
    const ops = [{ create: {
      adGroup: `customers/${cid}/adGroups/${a.adGroupId}`, status: "ENABLED",
      ad: { finalUrls: [a.finalUrl], responsiveSearchAd: {
        headlines: a.headlines.map((text) => ({ text })), descriptions: a.descriptions.map((text) => ({ text })),
        ...(a.path1 ? { path1: a.path1 } : {}), ...(a.path2 ? { path2: a.path2 } : {}),
      } },
    } }];
    await mutate(auth, cid, "adGroupAds", ops, undefined, { validateOnly: true });
    const [created] = await mutate(auth, cid, "adGroupAds", ops);
    const me = await currentUser();
    await q(`INSERT INTO action_log (client_id, user_id, kind, params, summary, status, result, undo) VALUES ($1,$2,'add_ad',$3,$4,'applied',$5,$6)`,
      [client.id, me?.id ?? null, JSON.stringify({ adGroupId: a.adGroupId, headlines: a.headlines.length }), `Added a new ad with ${a.headlines.length} headlines`,
       JSON.stringify(created ?? null), JSON.stringify({ kind: "pause_ad", resourceName: created?.resourceName })]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return failure(err, 400);
  }
}
