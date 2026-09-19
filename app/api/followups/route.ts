import { NextResponse, type NextRequest } from "next/server";
import { q } from "@/lib/db";
import { body, failure, scopedClient } from "@/lib/api";

export const runtime = "nodejs";

/** Mark a follow-up done or dismissed. */
export async function PATCH(req: NextRequest) {
  const b = await body(req);
  const client = await scopedClient(b?.client, "view");
  if (client instanceof NextResponse) return client;
  if (!["done", "dismissed", "open"].includes(b?.status)) return NextResponse.json({ error: "Pass a status." }, { status: 400 });
  try {
    await q(`UPDATE follow_ups SET status = $3 WHERE id = $1 AND client_id = $2`, [Number(b.id), client.id, b.status]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return failure(err);
  }
}
