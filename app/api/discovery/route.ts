import { NextResponse } from "next/server";
import { activeConnection } from "@/lib/google/auth";
import { runDiscovery } from "@/lib/google/discovery";
import { AuthExpiredError } from "@/lib/google/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST() {
  const conn = await activeConnection();
  if (!conn) {
    return NextResponse.json({ error: "No active Google connection." }, { status: 400 });
  }

  try {
    const report = await runDiscovery(conn.id, { deriveDomains: true });
    return NextResponse.json(report);
  } catch (err) {
    if (err instanceof AuthExpiredError) {
      return NextResponse.json(
        { error: "reconnect", message: "Your Google authorisation is no longer valid. Sign in again." },
        { status: 401 }
      );
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
