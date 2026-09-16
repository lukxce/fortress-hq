import { q } from "@/lib/db";
import { clientsWithProperties } from "@/lib/binding";
import { Sidebar } from "@/components/shell/Sidebar";
import { AskBubble } from "@/components/shell/AskBubble";
import { currentUser, isAdmin, identityConfigured } from "@/lib/user";

export const dynamic = "force-dynamic";

// The signed-in application. Public pages (landing, login, privacy) live
// outside this group, so client names never render for a visitor.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [clients, me] = await Promise.all([clientsWithProperties().catch(() => []), currentUser().catch(() => null)]);
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
        admin={isAdmin(me)}
        identity={identityConfigured}
        email={me?.email ?? null}
        clients={clients.map((c) => ({
          id: c.id, name: c.name, urgent: byClient[c.id] ?? 0,
          ads: Boolean(c.ads_customer_id), analytics: Boolean(c.ga4_property_id),
          searchConsole: Boolean(c.gsc_site_url), tagManager: Boolean(c.gtm_container_id),
        }))}
      />
      <main className="main">{children}</main>
      <AskBubble />
    </div>
  );
}
