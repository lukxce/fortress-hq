import { NextResponse, type NextRequest } from "next/server";
import { goLive } from "@/lib/jobs/launch";
import { body, failure, scopedClient } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Switch a campaign that was built paused on. Always its own, explicit decision. */
export async function POST(req: NextRequest) {
  const b = await body(req);
  const client = await scopedClient(b?.client);
  if (client instanceof NextResponse) return client;
  if (b?.confirm !== true) return NextResponse.json({ error: "Going live needs an explicit confirmation." }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await goLive(client.id, Number(b.id))) });
  } catch (err) {
    return failure(err, 400);
  }
}
