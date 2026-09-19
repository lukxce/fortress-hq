import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { q } from "@/lib/db";
import { body, failure, scopedClient } from "@/lib/api";
import { analyseCompetitor, cleanDomain, fetchSerpAds, suggestCompetitors } from "@/lib/competitors";

export const runtime = "nodejs";
export const maxDuration = 180;

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), client: z.number().int(), name: z.string().trim().min(1).max(120), website: z.string().trim().max(300).default("") }),
  z.object({ action: z.literal("analyse"), client: z.number().int(), id: z.number().int() }),
  z.object({ action: z.literal("status"), client: z.number().int(), id: z.number().int(), status: z.enum(["confirmed", "ignored"]) }),
  z.object({ action: z.literal("delete"), client: z.number().int(), id: z.number().int() }),
  z.object({ action: z.literal("observe"), client: z.number().int(), id: z.number().int(), text: z.string().trim().min(5).max(2000) }),
  z.object({ action: z.literal("suggest"), client: z.number().int() }),
  z.object({ action: z.literal("serp"), client: z.number().int() }),
]);

export async function POST(req: NextRequest) {
  const parsed = Action.safeParse(await body(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Bad request." }, { status: 400 });
  const a = parsed.data;
  const client = await scopedClient(a.client);
  if (client instanceof NextResponse) return client;
  try {
    switch (a.action) {
      case "add": {
        const domain = a.website ? cleanDomain(a.website) : null;
        const [row] = await q<{ id: number }>(`INSERT INTO competitors (client_id, name, domain, source, status) VALUES ($1,$2,$3,'manual','confirmed')
                                              ON CONFLICT (client_id, domain) DO UPDATE SET name = EXCLUDED.name, status = 'confirmed' RETURNING id`, [client.id, a.name, domain]);
        // Read it straight away; a slow site is not a reason to lose the entry.
        const analysis = await analyseCompetitor(client.id, row.id).catch((e) => ({ errors: [(e as Error).message] }));
        return NextResponse.json({ id: row.id, analysis });
      }
      case "analyse": return NextResponse.json(await analyseCompetitor(client.id, a.id));
      case "status": await q(`UPDATE competitors SET status = $3 WHERE id = $1 AND client_id = $2`, [a.id, client.id, a.status]); return NextResponse.json({ ok: true });
      case "delete": await q(`DELETE FROM competitors WHERE id = $1 AND client_id = $2`, [a.id, client.id]); return NextResponse.json({ ok: true });
      case "observe":
        await q(`UPDATE competitors SET observed_ads = observed_ads || $3::jsonb WHERE id = $1 AND client_id = $2`,
          [a.id, client.id, JSON.stringify([{ text: a.text, at: new Date().toISOString() }])]);
        return NextResponse.json({ ok: true });
      case "suggest": {
        const list = await suggestCompetitors(client.id);
        for (const s of list) {
          await q(`INSERT INTO competitors (client_id, name, domain, source, status, why) VALUES ($1,$2,NULL,'suggested','suggested',$3)`, [client.id, s.name, s.why]);
        }
        return NextResponse.json({ suggested: list.length });
      }
      case "serp": return NextResponse.json(await fetchSerpAds(client.id));
    }
  } catch (err) {
    return failure(err, 400);
  }
}
