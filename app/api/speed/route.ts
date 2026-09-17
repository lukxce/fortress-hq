import { NextResponse, type NextRequest } from "next/server";
import { clientParam, failure, scopedClient } from "@/lib/api";
import { checkSpeed } from "@/lib/jobs/speed";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Run PageSpeed Insights on this project's key pages now. */
export async function POST(req: NextRequest) {
  const client = await scopedClient(clientParam(req), "view");
  if (client instanceof NextResponse) return client;
  try {
    return NextResponse.json({ pages: await checkSpeed(client.id) });
  } catch (err) {
    return failure(err);
  }
}
