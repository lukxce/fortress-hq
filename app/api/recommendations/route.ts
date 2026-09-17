import { NextResponse, type NextRequest } from "next/server";
import { q } from "@/lib/db";
import { body, failure, scopedClient } from "@/lib/api";

export const runtime = "nodejs";

/** Mark a recommendation done ("I did it myself"), dismissed, or open again. */
export async function PATCH(req: NextRequest) {
  const b = await body(req);
  const client = await scopedClient(b?.client);
  if (client instanceof NextResponse) return client;
  if (!["done", "dismissed", "open"].includes(b?.status)) {
    return NextResponse.json({ error: "status must be done, dismissed or open" }, { status: 400 });
  }
  try {
    const reason = ["not_relevant", "already_done", "wrong"].includes(b?.reason) ? b.reason : null;
    await q(`UPDATE recommendations SET status = $3, dismiss_reason = $4, updated_at = now() WHERE id = $1 AND client_id = $2`,
      [Number(b.id), client.id, b.status, b.status === "dismissed" ? reason : null]);
    // Dismissing a recommendation withdraws its un-started experiment.
    if (b.status === "dismissed") {
      await q(`DELETE FROM experiments WHERE recommendation_id = $1 AND client_id = $2 AND status = 'proposed'`, [Number(b.id), client.id]);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return failure(err);
  }
}
