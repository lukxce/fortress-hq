import { NextResponse, type NextRequest } from "next/server";
import { q } from "@/lib/db";
import { gtmImportFile, ga4MeasurementId } from "@/lib/google/goals";
import { clientFor, connectionForClient } from "@/lib/google/auth";
import { clientParam, scopedClient } from "@/lib/api";

export const runtime = "nodejs";

/** The Tag Manager import file for a goal Fortress created, as a download. */
export async function GET(req: NextRequest) {
  const client = await scopedClient(clientParam(req));
  if (client instanceof NextResponse) return client;
  const id = Number(new URL(req.url).searchParams.get("goal"));
  const [g] = await q<any>(`SELECT * FROM conversion_goals WHERE id = $1 AND client_id = $2`, [id, client.id]);
  if (!g?.conversion_id || !g?.conversion_label) {
    return NextResponse.json({ error: "That goal has no conversion label yet." }, { status: 404 });
  }
  let measurementId: string | null = null;
  if (client.ga4_property_id) {
    const conn = await connectionForClient(client.id);
    if (conn) measurementId = await ga4MeasurementId(await clientFor(conn.id), client.ga4_property_id).catch(() => null);
  }
  const trigger = g.trigger_kind === "event" ? { kind: "event" as const, value: g.trigger_value }
    : g.trigger_kind === "phone" ? { kind: "phone" as const }
    : { kind: "url" as const, match: (g.trigger_match ?? "contains") as "contains", value: g.trigger_value };
  const file = gtmImportFile({
    name: g.name, trigger, value: g.default_value != null ? Number(g.default_value) : null,
    conversionId: g.conversion_id, label: g.conversion_label, measurementId,
  });
  const slug = String(g.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "goal";
  return new NextResponse(JSON.stringify(file, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="gtm-${slug}.json"`,
    },
  });
}
