import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { q } from "@/lib/db";
import { currentUser, visibleConnections } from "@/lib/user";

export const runtime = "nodejs";

const Patch = z.object({
  ids: z.array(z.number().int()).min(1).max(500),
  status: z.enum(["selected", "available"]),
});

export async function PATCH(req: NextRequest) {
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { ids: number[], status }" }, { status: 400 });
  }
  const { ids, status } = parsed.data;

  // Managers are folders, not spendable accounts — they can never be selected.
  // A person can only tick accounts their own connection discovered.
  const me = await currentUser();
  const rows = await q<{ id: number }>(
    `UPDATE inventory
        SET status = $2
      WHERE id = ANY($1::int[])
        AND status <> 'revoked'
        AND NOT (provider = 'ads' AND is_manager AND $2 = 'selected')
        AND ${visibleConnections(me?.id ?? null, 3)}
      RETURNING id`,
    me ? [ids, status, me.id] : [ids, status]
  );

  return NextResponse.json({ updated: rows.map((r) => r.id) });
}
