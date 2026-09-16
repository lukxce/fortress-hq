import Link from "next/link";
import { setupStatus } from "@/lib/setup";
import { q } from "@/lib/db";
import { PickList, type InventoryRow } from "@/components/PickList";
import { ConnectionPanel } from "@/components/ConnectionPanel";
import { currentUser, visibleConnections } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function Connect({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const setup = await setupStatus();

  if (!setup.ready) {
    return (
      <div className="sheet sheet-pad rise" style={{ maxWidth: 620 }}>
        <h1 style={{ marginBottom: 10 }}>Not configured yet</h1>
        <p className="lede" style={{ marginBottom: 18 }}>
          The database, encryption key and OAuth client need to be set before you can sign in.
        </p>
        <Link href="/overview" className="btn btn-ghost">See what is missing</Link>
      </div>
    );
  }

  if (!setup.connected) {
    return (
      <div className="sheet sheet-pad rise" style={{ maxWidth: 640 }}>
        {sp.error && <div className="notice notice-bad">{sp.error}</div>}
        <span className="beacon">Not connected</span>
        <h1 style={{ margin: "20px 0 12px" }}>Sign in to Google.</h1>
        <p className="lede" style={{ marginBottom: 20 }}>
          One consent screen covers all four products. Nothing is imported until you pick it.
        </p>
        <Link href="/api/auth/google" className="btn btn-primary">Connect Google</Link>
      </div>
    );
  }

  // Only what this person's own Google sign-in can reach.
  const me = await currentUser();
  const rows = await q<InventoryRow>(`
    SELECT id, provider, provider_id, display_name, domain, parent_id, parent_name,
           is_manager, currency, timezone, status, extra,
           COALESCE((SELECT json_agg(json_build_object('id', c.id, 'name', c.name) ORDER BY c.name)
                       FROM client_properties cp JOIN clients c ON c.id = cp.client_id
                      WHERE cp.inventory_id = inventory.id AND NOT c.archived), '[]') AS projects
      FROM inventory
     WHERE status <> 'revoked' AND ${visibleConnections(me?.id ?? null, 1)}
     ORDER BY provider, is_manager DESC, display_name
  `, me ? [me.id] : []);

  return (
    <div className="stack rise">
      <header className="page-head">
        <div className="spread">
          <div>
            <h1>Connect</h1>
            <p className="lede">
              Signed in as {setup.email ?? "your Google account"}. Connect what you want Fortress to read, and disconnect anything to stop pulling its data.
            </p>
          </div>
        </div>
      </header>

      {sp.connected && (
        <div className="notice notice-good">
          Connected. Run discovery to see everything this account can reach.
        </div>
      )}
      {sp.error && <div className="notice notice-bad">{sp.error}</div>}

      <ConnectionPanel email={setup.email} access={setup.access} />

      <PickList initial={rows} />
    </div>
  );
}
