import { q } from "@/lib/db";
import { clientsWithProperties } from "@/lib/binding";
import { Sidebar } from "@/components/shell/Sidebar";
import { AskBubble } from "@/components/shell/AskBubble";
import { currentUser, realUser, isAdmin, identityConfigured } from "@/lib/user";
import { StopViewingAs } from "@/components/admin/StopViewingAs";

export const dynamic = "force-dynamic";

// The signed-in application. Public pages (landing, login, privacy) live
// outside this group, so client names never render for a visitor.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [clients, me, real] = await Promise.all([clientsWithProperties().catch(() => []), currentUser().catch(() => null), realUser().catch(() => null)]);
  const ids = clients.map((c) => c.id);
  const [urgent, syncs, findings] = ids.length ? await Promise.all([
    q<{ client_id: number; n: number }>(
      `SELECT client_id, count(*)::int AS n FROM recommendations
        WHERE status = 'open' AND severity = 'do_first' AND client_id = ANY($1)
        GROUP BY client_id`, [ids]).catch(() => []),
    q<{ client_id: number; at: string }>(
      `SELECT client_id, max(finished_at) AS at FROM job_runs WHERE job = 'sync' AND client_id = ANY($1) GROUP BY client_id`, [ids]).catch(() => []),
    // Judged problems only (never info), by the sidebar section they belong to.
    q<{ client_id: number; section: string; n: number }>(
      `SELECT client_id,
              CASE WHEN product = 'tag_manager' OR kind ~ '^(conversion_|tracking_|ads_tracking|micro_conversion|site_)' THEN 'tracking'
                   ELSE COALESCE(product, 'ads') END AS section,
              count(*)::int AS n
         FROM findings WHERE status = 'open' AND severity <> 'info' AND client_id = ANY($1)
          AND last_seen > now() - interval '14 days'
        GROUP BY 1, 2`, [ids]).catch(() => []),
  ]) : [[], [], []];
  const byClient = Object.fromEntries(urgent.map((u) => [u.client_id, u.n]));
  const syncedAt = Object.fromEntries(syncs.map((s) => [s.client_id, s.at]));
  const counts: Record<number, Record<string, number>> = {};
  for (const f of findings) (counts[f.client_id] ??= {})[f.section] = f.n;

  return (
    <div className="app">
      <Sidebar
        admin={isAdmin(real)}
        identity={identityConfigured}
        email={real?.email ?? null}
        clients={clients.map((c) => ({
          id: c.id, name: c.name, urgent: byClient[c.id] ?? 0,
          syncedAt: syncedAt[c.id] ?? null, counts: counts[c.id] ?? {},
          ads: Boolean(c.ads_customer_id), analytics: Boolean(c.ga4_property_id),
          searchConsole: Boolean(c.gsc_site_url), tagManager: Boolean(c.gtm_container_id), businessProfile: Boolean(c.gbp_location_id),
        }))}
      />
      <main className="main">
        {me?.viewedBy && (
          <div className="notice notice-warn" style={{ marginBottom: 18 }}>
            <div className="spread" style={{ width: "100%", gap: 12 }}>
              <span>Viewing as <strong>{me.email ?? me.name ?? `user ${me.id}`}</strong> — you see exactly their projects. Read-only: nothing can be changed.</span>
              <StopViewingAs />
            </div>
          </div>
        )}
        {children}
      </main>
      <AskBubble />
    </div>
  );
}
