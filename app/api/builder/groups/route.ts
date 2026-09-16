import { NextResponse, type NextRequest } from "next/server";
import { suggestGroups } from "@/lib/builder/suggest";
import { body, failure, scopedClient } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  const b = await body(req);
  const client = await scopedClient(b?.client);
  if (client instanceof NextResponse) return client;
  try {
    return NextResponse.json({ groups: await suggestGroups(client.id, b?.summary ?? null, b?.places ?? []) });
  } catch (err) {
    return failure(err, 400);
  }
}
