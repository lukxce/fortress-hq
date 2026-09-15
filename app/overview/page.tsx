import Link from "next/link";
import { setupStatus } from "@/lib/setup";
import { q } from "@/lib/db";
import { SetupChecklist } from "@/components/SetupChecklist";

export const dynamic = "force-dynamic";

export default async function Home() {
  const setup = await setupStatus();

  if (!setup.ready) {
    return (
      <div className="rise">
        <header className="page-head">
          <h1>Nearly there.</h1>
          <p className="lede">
            Three things need to be in place before Fortress HQ can reach your accounts.
          </p>
        </header>
        <SetupChecklist checks={setup.checks} />
      </div>
    );
  }

  if (!setup.connected) {
    return (
      <div className="sheet sheet-pad rise" style={{ maxWidth: 640 }}>
        <span className="beacon">Not connected</span>
        <h1 style={{ margin: "20px 0 12px" }}>Sign in to Google.</h1>
        <p className="lede" style={{ marginBottom: 20 }}>
          One consent screen covers Google Ads, Analytics, Search Console and Tag
          Manager. Nothing is read or changed until you choose which accounts to
          import.
        </p>
        <Link href="/api/auth/google" className="btn btn-primary">
          Connect Google
        </Link>
        <p className="meta" style={{ marginTop: 16 }}>
          Expect a passkey prompt. Since August 2026 Google requires passkey
          authentication to issue a new refresh token.
        </p>
      </div>
    );
  }

  const [counts] = await q<{
    selected: string; available: string; clients: string;
  }>(`
    SELECT
      (SELECT count(*) FROM inventory WHERE status = 'selected')                   AS selected,
      (SELECT count(*) FROM inventory WHERE status = 'available' AND NOT is_manager) AS available,
      (SELECT count(*) FROM clients WHERE NOT archived)                            AS clients
  `);

  const selected = Number(counts?.selected ?? 0);
  const available = Number(counts?.available ?? 0);
  const clients = Number(counts?.clients ?? 0);

  return (
    <div className="stack rise">
      <header className="page-head">
        <h1>Overview</h1>
        <p className="lede">Signed in as {setup.email ?? "your Google account"}.</p>
      </header>

      <div className="tiles">
        <Tile label="Accounts selected" value={selected} />
        <Tile label="Available to import" value={available} />
        <Tile label="Clients configured" value={clients} />
      </div>

      {selected === 0 && (
        <div className="sheet sheet-pad">
          <h2 style={{ marginBottom: 8 }}>Choose what to import</h2>
          <p style={{ marginBottom: 18 }}>
            Discovery has {available > 0 ? `found ${available} account${available === 1 ? "" : "s"} you can reach` : "not run yet"}.
            Nothing syncs until you select it, so an unselected account costs nothing.
          </p>
          <Link href="/connect" className="btn btn-accent">Open the pick list</Link>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="sheet tile">
      <span className="label">{label}</span>
      <span className="tile-value num">{value}</span>
    </div>
  );
}
