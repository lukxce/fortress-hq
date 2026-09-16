import { NextResponse, type NextRequest } from "next/server";
import { q } from "@/lib/db";
import { startExperiment } from "@/lib/jobs/evaluate";
import { body, failure, scopedClient } from "@/lib/api";

export const runtime = "nodejs";

/**
 * op "start": the operator made the change themselves; the clock starts now.
 * op "abandon": stop a running test without a verdict, so it never pollutes
 * the track record.
 */
export async function POST(req: NextRequest) {
  const b = await body(req);
  const client = await scopedClient(b?.client);
  if (client instanceof NextResponse) return client;
  try {
    if (b?.op === "start") {
      await startExperiment(client.id, Number(b.id), "manual");
      await q(`UPDATE recommendations SET status = 'done', updated_at = now()
                WHERE id = (SELECT recommendation_id FROM experiments WHERE id = $1) AND client_id = $2`, [Number(b.id), client.id]);
      return NextResponse.json({ ok: true });
    }
    if (b?.op === "abandon") {
      await q(`UPDATE experiments SET status = 'abandoned' WHERE id = $1 AND client_id = $2 AND status IN ('proposed','running')`,
        [Number(b.id), client.id]);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "op must be start or abandon" }, { status: 400 });
  } catch (err) {
    return failure(err, 400);
  }
}
