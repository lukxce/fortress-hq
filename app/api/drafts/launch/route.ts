import { NextResponse, type NextRequest } from "next/server";
import { launchDraft, dryRunDraft } from "@/lib/jobs/launch";
import { body, failure, scopedClient } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const b = await body(req);
  const client = await scopedClient(b?.client);
  if (client instanceof NextResponse) return client;
  if (b?.confirm !== true) return NextResponse.json({ error: "Launching needs an explicit confirmation." }, { status: 400 });
  try {
    // Google checks the whole campaign before anything is created.
    const check = await dryRunDraft(client.id, Number(b.id));
    if (!check.ok) return NextResponse.json({ error: `Google would reject this campaign: ${check.error}` }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await launchDraft(client.id, Number(b.id), { goLive: b.goLive === true })) });
  } catch (err) {
    return failure(err, 400);
  }
}
