import { NextResponse, type NextRequest } from "next/server";
import { clientParam, failure, scopedClient } from "@/lib/api";
import { runTagCheck } from "@/lib/tracking/tagcheck";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Check the live site and containers for this project's Google tags now. */
export async function POST(req: NextRequest) {
  const client = await scopedClient(clientParam(req), "view");
  if (client instanceof NextResponse) return client;
  try {
    return NextResponse.json(await runTagCheck(client.id));
  } catch (err) {
    return failure(err);
  }
}
