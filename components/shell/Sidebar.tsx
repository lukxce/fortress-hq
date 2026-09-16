"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type ClientItem = { id: number; name: string; urgent: number; ads: boolean; analytics: boolean; searchConsole: boolean; tagManager: boolean };

const I = {
  overview: <path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z" />,
  change: <path d="M3 4h10M3 8h10M3 12h6" />,
  experiments: <path d="M6 2v4L2.5 13a1 1 0 0 0 .9 1.5h9.2a1 1 0 0 0 .9-1.5L10 6V2M5 2h6" />,
  tracking: <path d="M8 14s5-4 5-8a5 5 0 0 0-10 0c0 4 5 8 5 8zM8 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />,
  builder: <path d="M8 3v10M3 8h10" />,
  reports: <path d="M3 13V8M8 13V3M13 13V6" />,
  brain: <path d="M8 2a4 4 0 0 0-4 4c0 1.5.8 2.3 1.5 3 .5.5.5 1 .5 2h4c0-1 0-1.5.5-2 .7-.7 1.5-1.5 1.5-3a4 4 0 0 0-4-4zM6.5 14h3" />,
  clients: <path d="M2 13c0-2 2-3.5 4-3.5S10 11 10 13M6 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM11 3.2a2.5 2.5 0 0 1 0 4.6M12 9.8c1.2.5 2 1.6 2 3.2" />,
  connect: <path d="M6.5 9.5l3-3M5 7.5L3.5 9a2.5 2.5 0 0 0 3.5 3.5L8.5 11M11 8.5L12.5 7A2.5 2.5 0 0 0 9 3.5L7.5 5" />,
  out: <path d="M10 4V2.5H3v11h7V12M7 8h7M12 6l2 2-2 2" />,
  campaigns: <path d="M2.5 6.5v3l7 3.5V3zM9.5 5.5h2a2.5 2.5 0 0 1 0 5h-2M4.5 10l.8 3.5" />,
  search: <path d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM14 14l-3.5-3.5" />,
  traffic: <path d="M2 12l4-4 3 3 5-6M10 5h4v4" />,
  pages: <path d="M4 2h5l3 3v9H4zM9 2v3h3" />,
  events: <path d="M8 2v3M8 11v3M2 8h3M11 8h3M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />,
  opportunity: <path d="M8 2l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3 4.3 13.3l.8-4.1L2 6.3l4.2-.5z" />,
  tags: <path d="M2 2h6l6 6-6 6-6-6zM5 5h.01" />,
  settings: <path d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM13 8l1.5-1-1-2.2-1.8.3-1-1L11 2.3 8.8 2 8 3.5 7.2 2 5 2.3l.3 1.8-1 1-1.8-.3-1 2.2L3 8l-1.5 1 1 2.2 1.8-.3 1 1-.3 1.8 2.2.3.8-1.5.8 1.5 2.2-.3-.3-1.8 1-1 1.8.3 1-2.2z" />,
  people: <path d="M2 13c0-2 2-3.5 4-3.5S10 11 10 13M6 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM11 3.2a2.5 2.5 0 0 1 0 4.6M12 9.8c1.2.5 2 1.6 2 3.2" />,
};

function Icon({ d }: { d: React.ReactNode }) {
  return (
    <svg className="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d}
    </svg>
  );
}

type NavLink = { href: string; label: string; icon: React.ReactNode; exact?: boolean; count?: number };
type Section = { title: string | null; links: NavLink[]; connected?: boolean };

export function Sidebar({ clients, admin }: { clients: ClientItem[]; admin: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const match = path.match(/^\/clients\/(\d+)/);
  const clientId = match ? Number(match[1]) : null;
  const current = clients.find((c) => c.id === clientId) ?? null;
  const base = `/clients/${clientId}`;

  // By product first, because that is how the work is split; but the jobs that
  // cut across products — what to change, reports, settings — sit above them.
  const sections: Section[] = clientId ? [
    { title: null, links: [
      { href: base, label: "Overview", icon: I.overview, exact: true },
      { href: `${base}/insights`, label: "What to change", icon: I.change, count: current?.urgent },
      { href: `${base}/reports`, label: "Reports", icon: I.reports },
    ] },
    { title: "Google Ads", connected: current?.ads, links: [
      { href: `${base}/ads`, label: "Campaigns", icon: I.campaigns, exact: true },
      { href: `${base}/ads/search-terms`, label: "Search terms & keywords", icon: I.search },
      { href: `${base}/experiments`, label: "Experiments", icon: I.experiments },
      { href: `${base}/builder`, label: "New campaign", icon: I.builder },
    ] },
    { title: "Analytics", connected: current?.analytics, links: [
      { href: `${base}/analytics`, label: "Traffic & channels", icon: I.traffic, exact: true },
      { href: `${base}/analytics/pages`, label: "Landing pages", icon: I.pages },
      { href: `${base}/analytics/events`, label: "Events", icon: I.events },
    ] },
    { title: "Search Console", connected: current?.searchConsole, links: [
      { href: `${base}/search-console`, label: "Searches", icon: I.search, exact: true },
      { href: `${base}/search-console/pages`, label: "Pages", icon: I.pages },
      { href: `${base}/search-console/opportunities`, label: "Opportunities", icon: I.opportunity },
    ] },
    { title: "Tag Manager", connected: current?.tagManager, links: [
      { href: `${base}/tag-manager`, label: "Tags & health", icon: I.tags },
      { href: `${base}/tracking`, label: "Conversion tracking", icon: I.tracking },
    ] },
    { title: null, links: [{ href: `${base}/settings`, label: "Project settings", icon: I.settings }] },
  ] : [];

  const active = (href: string, exact?: boolean) => (exact ? path === href : path === href || path.startsWith(`${href}/`));

  async function signOut() {
    await fetch("/api/login", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  }

  const link = (l: NavLink) => (
    <Link key={l.href} href={l.href as never} className={`side-link${active(l.href, l.exact) ? " active" : ""}`}>
      <Icon d={l.icon} />
      {l.label}
      {l.count ? <span className="count">{l.count}</span> : null}
    </Link>
  );

  return (
    <aside className="sidebar">
      <Link href="/overview" className="brand">
        <span className="brand-dot" aria-hidden />
        Fortress HQ
      </Link>

      {clients.length > 0 && (
        <div className="switcher">
          <select
            aria-label="Project"
            value={clientId ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              if (!id) return router.push("/overview");
              // Stay on the same page for the new project where there is one.
              const rest = clientId ? path.replace(/^\/clients\/\d+/, "") : "";
              router.push(`/clients/${id}${rest}` as never);
            }}
          >
            <option value="">All projects</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {sections.map((sec, i) => (
        <div key={i} className="side-section">
          {sec.title && (
            <div className="side-label label side-sub">
              {sec.title}
              {sec.connected === false && <Link href={`${base}/settings` as never} className="side-connect">connect</Link>}
            </div>
          )}
          {sec.connected !== false && <nav className="side-nav">{sec.links.map(link)}</nav>}
        </div>
      ))}

      <div className="side-label label">Portfolio</div>
      <nav className="side-nav">
        <Link href="/overview" className={`side-link${active("/overview") ? " active" : ""}`}><Icon d={I.overview} />All projects</Link>
        <Link href="/clients" className={`side-link${path === "/clients" ? " active" : ""}`}><Icon d={I.clients} />Add or manage projects</Link>
        <Link href="/connect" className={`side-link${active("/connect") ? " active" : ""}`}><Icon d={I.connect} />Connections</Link>
      </nav>

      {admin && (
        <>
          <div className="side-label label">Admin</div>
          <nav className="side-nav">
            <Link href={"/admin/brain" as never} className={`side-link${active("/admin/brain") ? " active" : ""}`}><Icon d={I.brain} />Brain</Link>
            <Link href={"/admin/users" as never} className={`side-link${active("/admin/users") ? " active" : ""}`}><Icon d={I.people} />People &amp; access</Link>
          </nav>
        </>
      )}

      <div className="side-foot">
        <button className="side-link" style={{ background: "none", border: 0, font: "inherit", cursor: "pointer", textAlign: "left" }} onClick={signOut}>
          <Icon d={I.out} />Sign out
        </button>
      </div>
    </aside>
  );
}
