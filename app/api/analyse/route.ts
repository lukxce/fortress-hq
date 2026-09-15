import { NextResponse, type NextRequest } from "next/server";
import { analyseClient, brainConfigured } from "@/lib/brain/analyse";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const clientId = Number(new URL(req.url).searchParams.get("client"));
  if (!Number.isFinite(clientId)) {
    return NextResponse.json({ error: "Pass ?client=<id>" }, { status: 400 });
  }
  if (!brainConfigured()) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set, so analysis is unavailable." },
      { status: 400 }
    );
  }
  try {
    return NextResponse.json(await analyseClient(clientId));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
