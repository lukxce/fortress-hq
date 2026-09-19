import { NextResponse, type NextRequest } from "next/server";
import { dryRunDraft } from "@/lib/jobs/launch";
import { body, failure, scopedClient } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Send the whole campaign to Google as a check. Nothing is created. */
export async function POST(req: NextRequest) {
  const b = await body(req);
  const client = await scopedClient(b?.client);
  if (client instanceof NextResponse) return client;
  try {
    return NextResponse.json(await dryRunDraft(client.id, Number(b.id)));
  } catch (err) {
    return failure(err, 400);
  }
}
