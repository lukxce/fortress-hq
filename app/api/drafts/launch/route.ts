import { NextResponse, type NextRequest } from "next/server";
import { launchDraft } from "@/lib/jobs/launch";
import { body, failure, scopedClient } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const b = await body(req);
  const client = await scopedClient(b?.client);
  if (client instanceof NextResponse) return client;
  if (b?.confirm !== true) return NextResponse.json({ error: "Launching needs an explicit confirmation." }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await launchDraft(client.id, Number(b.id))) });
  } catch (err) {
    return failure(err, 400);
  }
}
