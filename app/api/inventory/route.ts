import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { q, tx } from "@/lib/db";
import { currentUser, visibleConnections } from "@/lib/user";
import { canManage } from "@/lib/api";
import { unbind } from "@/lib/unbind";

export const runtime = "nodejs";

const Patch = z.object({
  ids: z.array(z.number().int()).min(1).max(500),
  action: z.enum(["connect", "disconnect"]),
});

/**
 * Connect: make an account available to projects.
 * Disconnect: stop pulling it anywhere — every project this person can manage
 * that reads it loses the binding and the data pulled from it. The project
 * itself stays; deleting a project is a separate, deliberate step.
 */
export async function PATCH(req: NextRequest) {
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Expected { ids: number[], action }" }, { status: 400 });
  const { ids, action } = parsed.data;
  const me = await currentUser();

  // Managers are folders, not spendable accounts — they can never be connected.
  const rows = await q<{ id: number; provider: "ads" | "ga4" | "gsc" | "gtm" | "gbp" }>(
    `SELECT id, provider FROM inventory
      WHERE id = ANY($1::int[]) AND status <> 'revoked'
        AND NOT (provider = 'ads' AND is_manager)
        AND ${visibleConnections(me?.id ?? null, 2)}`,
    me ? [ids, me.id] : [ids]
  );
  if (!rows.length) return NextResponse.json({ error: "Nothing you can change." }, { status: 404 });

  const stopped: string[] = [];
  const blocked: string[] = [];
  if (action === "disconnect") {
    for (const r of rows) {
      const users = await q<{ id: number; name: string; owner_id: number | null }>(
        `SELECT c.id, c.name, c.owner_id FROM client_properties cp JOIN clients c ON c.id = cp.client_id
          WHERE cp.inventory_id = $1 AND NOT c.archived`, [r.id]);
      for (const c of users) {
        if (!(await canManage(c))) { blocked.push(c.name); continue; }
        await tx(async (run) => { await unbind(run as any, c.id, r.provider); });
        stopped.push(c.name);
      }
    }
  }
  await q(`UPDATE inventory SET status = $2 WHERE id = ANY($1::int[])`,
    [rows.map((r) => r.id), action === "connect" ? "selected" : "available"]);
  return NextResponse.json({ updated: rows.map((r) => r.id), stoppedIn: stopped, blockedIn: blocked });
}
