import { NextResponse, type NextRequest } from "next/server";
import { suggestLocations } from "@/lib/builder/suggest";
import { clientParam, failure, scopedClient } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const client = await scopedClient(clientParam(req));
  if (client instanceof NextResponse) return client;
  const sp = new URL(req.url).searchParams;
  const query = (sp.get("q") ?? "").trim();
  if (query.length < 2) return NextResponse.json({ locations: [] });
  try {
    return NextResponse.json({ locations: await suggestLocations(client.id, query, sp.get("country") ?? "RS") });
  } catch (err) {
    return failure(err);
  }
}
