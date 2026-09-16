import { NextResponse, type NextRequest } from "next/server";
import { syncClient } from "@/lib/jobs/sync";
import { computeFindings, storeFindings } from "@/lib/engine/findings";
import { AuthExpiredError } from "@/lib/google/auth";
import { clientParam, scopedClient } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const scoped = await scopedClient(clientParam(req));
  if (scoped instanceof NextResponse) return scoped;
  const clientId = scoped.id;
  try {
    const report = await syncClient(clientId);
    // Findings depend only on what was just synced, and are cheap, so they are
    // recomputed here rather than left to drift behind the data.
    const findings = await computeFindings(clientId);
    await storeFindings(clientId, findings);
    return NextResponse.json({ ...report, findings: findings.length });
  } catch (err) {
    if (err instanceof AuthExpiredError) {
      return NextResponse.json(
        { error: "reconnect", message: "Google authorisation is no longer valid." },
        { status: 401 }
      );
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
