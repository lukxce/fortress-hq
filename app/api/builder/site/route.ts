import { NextResponse, type NextRequest } from "next/server";
import { distil } from "@/lib/builder/site";
import { body, failure, scopedClient } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  const b = await body(req);
  const client = await scopedClient(b?.client);
  if (client instanceof NextResponse) return client;
  try {
    return NextResponse.json({ summary: await distil(client.id, String(b?.url ?? "")) });
  } catch (err) {
    return failure(err, 400);
  }
}
