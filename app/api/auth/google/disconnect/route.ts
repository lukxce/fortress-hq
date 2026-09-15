import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { activeConnection } from "@/lib/google/auth";

export const runtime = "nodejs";

/**
 * Revoke at Google and delete locally. Both halves matter: deleting our copy
 * without revoking leaves a live grant sitting in the Google account that the
 * user would then have to hunt down and remove by hand.
 */
export async function POST() {
  const conn = await activeConnection();
  if (!conn) return NextResponse.json({ ok: true, note: "nothing to disconnect" });

  if (conn.refresh_token_enc) {
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: decrypt(conn.refresh_token_enc) }),
      });
    } catch {
      // A token Google has already forgotten still needs removing locally.
    }
  }

  await q("UPDATE inventory SET status = 'revoked' WHERE connection_id = $1", [conn.id]);
  await q("DELETE FROM connections WHERE id = $1", [conn.id]);

  return NextResponse.json({ ok: true });
}
