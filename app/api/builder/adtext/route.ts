import { NextResponse, type NextRequest } from "next/server";
import { suggestAdText } from "@/lib/builder/suggest";
import { body, failure, scopedClient } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const b = await body(req);
  const client = await scopedClient(b?.client);
  if (client instanceof NextResponse) return client;
  try {
    return NextResponse.json(await suggestAdText(b?.summary ?? null, b?.group ?? { name: "", keywords: [], finalUrl: "" }));
  } catch (err) {
    return failure(err, 400);
  }
}
