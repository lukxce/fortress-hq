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
  const urgent = clients.length
    ? await q<{ client_id: number; n: number }>(
        `SELECT client_id, count(*)::int AS n FROM recommendations
          WHERE status = 'open' AND severity = 'do_first' AND client_id = ANY($1)
          GROUP BY client_id`, [clients.map((c) => c.id)]).catch(() => [])
    : [];
  const byClient = Object.fromEntries(urgent.map((u) => [u.client_id, u.n]));

  return (
    <div className="app">
      <Sidebar
        admin={isAdmin(real)}
        identity={identityConfigured}
        email={real?.email ?? null}
        clients={clients.map((c) => ({
          id: c.id, name: c.name, urgent: byClient[c.id] ?? 0,
          ads: Boolean(c.ads_customer_id), analytics: Boolean(c.ga4_property_id),
          searchConsole: Boolean(c.gsc_site_url), tagManager: Boolean(c.gtm_container_id),
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
