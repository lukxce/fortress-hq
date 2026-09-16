import { NextResponse, type NextRequest } from "next/server";
import { clientWithProperties, type ClientWithProps } from "@/lib/binding";
import { AuthExpiredError } from "@/lib/google/auth";

/**
 * Shared plumbing for client-scoped routes.
 *
 * Every client id arriving from the browser is resolved through the signed-in
 * user's scope: a client they cannot see is a 404, never a 403, so ids cannot
 * be probed.
 */
export async function scopedClient(raw: unknown): Promise<ClientWithProps | NextResponse> {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Pass a client id." }, { status: 400 });
  const client = await clientWithProperties(id);
  if (!client) return NextResponse.json({ error: "No such client." }, { status: 404 });
  return client;
}

export const clientParam = (req: NextRequest) => new URL(req.url).searchParams.get("client");

export function failure(err: unknown, status = 500) {
  if (err instanceof AuthExpiredError) {
    return NextResponse.json({ error: "reconnect", message: "Google authorisation is no longer valid. Reconnect on the Connections page." }, { status: 401 });
  }
  return NextResponse.json({ error: (err as Error)?.message ?? String(err) }, { status });
}

export async function body<T = any>(req: NextRequest): Promise<T | null> {
  return (await req.json().catch(() => null)) as T | null;
}
