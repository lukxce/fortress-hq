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
    return NextResponse.json({ error: "Analysis is not set up on this installation yet — the admin needs to add the AI key." }, { status: 400 });
  }
  try {
    return NextResponse.json(await recommend(client.id, { force: new URL(req.url).searchParams.get("force") === "1" }));
  } catch (err) {
    return failure(err);
  }
}
