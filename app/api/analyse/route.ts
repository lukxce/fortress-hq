import { NextResponse, type NextRequest } from "next/server";
import { recommend, brainConfigured } from "@/lib/brain/recommend";
import { clientParam, failure, scopedClient } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Findings → brain → recommendations. */
export async function POST(req: NextRequest) {
  const client = await scopedClient(clientParam(req));
  if (client instanceof NextResponse) return client;
  if (!brainConfigured()) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set, so analysis is unavailable." }, { status: 400 });
  }
  try {
    return NextResponse.json(await recommend(client.id));
  } catch (err) {
    return failure(err);
  }
}
