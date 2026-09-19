"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SignOut } from "./SignOut";
import { Palette } from "./Palette";
import { BUSINESS_PROFILE_ENABLED } from "@/lib/features";
import { ago } from "@/lib/format";

export type ClientItem = {
  id: number; name: string; urgent: number; syncedAt: string | null; counts: Record<string, number>;
  ads: boolean; analytics: boolean; searchConsole: boolean; tagManager: boolean; businessProfile: boolean;
};

export const I = {
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
  menu: <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />,
  ask: <path d="M3 3h10v7H7l-3 3v-3H3z" />,
  chev: <path d="M6 4l4 4-4 4" />,
  people: <path d="M2 13c0-2 2-3.5 4-3.5S10 11 10 13M6 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM11 3.2a2.5 2.5 0 0 1 0 4.6M12 9.8c1.2.5 2 1.6 2 3.2" />,
};

function Icon({ d }: { d: React.ReactNode }) {
  return (
    <svg className="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d}
    </svg>
  );
}

type NavLink = { href: string; label: string; icon?: React.ReactNode; exact?: boolean; count?: number };
type Group = { key: string; title: string; icon: React.ReactNode; connected: boolean; links: NavLink[]; count?: number; connectLabel?: string };

/**
 * One project's workspace. The work comes first (Overview, What to change,
 * Experiments, Reports); then its sources in the order problems are fixed —
 * tracking before anything that depends on it. Sections collapse, keeping a
 * count of judged problems visible, and portfolio and admin sit in the
 * switcher and the footer rather than in the body.
 */
export function Sidebar({ clients, admin, identity, email }: { clients: ClientItem[]; admin: boolean; identity: boolean; email: string | null }) {
  const path = usePathname();
  const router = useRouter();
  const match = path.match(/^\/clients\/(\d+)/);
  const clientId = match ? Number(match[1]) : null;
  const current = clients.find((c) => c.id === clientId) ?? null;
  const base = `/clients/${clientId}`;
  const [palette, setPalette] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => { setSheet(false); }, [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const active = (href: string, exact?: boolean) => (exact ? path === href : path === href || path.startsWith(`${href}/`));
  const c = current?.counts ?? {};

  const work: NavLink[] = clientId ? [
    { href: base, label: "Overview", icon: I.overview, exact: true },
    { href: `${base}/insights`, label: "What to change", icon: I.change, count: current?.urgent },
    { href: `${base}/experiments`, label: "Experiments", icon: I.experiments },
    { href: `${base}/reports`, label: "Reports", icon: I.reports },
    { href: `${base}/changes`, label: "Changes", icon: I.experiments },
  ] : [];

  const groups: Group[] = clientId ? [
    { key: "tracking", title: "Tracking", icon: I.tracking, connected: true, count: c.tracking, links: [
      { href: `${base}/tag-manager`, label: "Tags on the site" },
      { href: `${base}/tracking`, label: "Conversions" },
    ] },
    { key: "ads", title: "Google Ads", icon: I.campaigns, connected: Boolean(current?.ads), count: c.ads, links: [
      { href: `${base}/launch`, label: "Launch a campaign" },
      { href: `${base}/ads`, label: "Campaigns", exact: true },
      { href: `${base}/ads/copy`, label: "Ads & copy" },
      { href: `${base}/ads/search-terms`, label: "Search terms & keywords" },
      { href: `${base}/ads/keywords`, label: "Keyword research" },
      { href: `${base}/builder`, label: "Campaign builder" },
    ] },
    { key: "analytics", title: "Analytics", icon: I.traffic, connected: Boolean(current?.analytics), count: c.analytics, links: [
      { href: `${base}/analytics`, label: "Traffic", exact: true },
      { href: `${base}/analytics/pages`, label: "Landing pages" },
      { href: `${base}/analytics/events`, label: "Events" },
    ] },
    { key: "search_console", title: "Search Console", icon: I.search, connected: Boolean(current?.searchConsole), count: c.search_console, links: [
      { href: `${base}/search-console`, label: "Organic searches", exact: true },
      { href: `${base}/search-console/pages`, label: "Pages" },
      { href: `${base}/search-console/opportunities`, label: "Opportunities" },
    ] },
    { key: "website", title: "Website", icon: I.pages, connected: true, count: c.website, links: [
      { href: `${base}/website`, label: "Page speed" },
    ] },
    ...(BUSINESS_PROFILE_ENABLED ? [{ key: "business_profile", title: "Business Profile", icon: I.opportunity, connected: Boolean(current?.businessProfile), count: c.business_profile, links: [
      { href: `${base}/business-profile`, label: "Calls, searches & reviews" },
    ] }] : []),
  ] : [];
  const openGroup = groups.find((g) => g.links.some((l) => active(l.href, l.exact)))?.key ?? null;

  async function sync() {
    if (!clientId) return;
    setSyncing(true);
    await fetch(`/api/sync?client=${clientId}`, { method: "POST" }).catch(() => null);
    setSyncing(false);
    router.refresh();
  }

  const link = (l: NavLink) => (
    <Link key={l.href} href={l.href as never} className={`side-link${active(l.href, l.exact) ? " active" : ""}`}>
      {l.icon && <Icon d={l.icon} />}
      {l.label}
      {l.count ? <span className="badge bad">{l.count}</span> : null}
    </Link>
  );

  const switcher = (
    <button className="switch-btn" onClick={() => setPalette(true)} aria-label="Switch project or search">
      <span className={`dot ${current ? (current.urgent ? "bad" : "ok") : "hollow"}`} aria-hidden />
      <span className="name">{current?.name ?? "All projects"}</span>
      <span className="kbd">⌘K</span>
    </button>
  );

  const stale = current && (!current.syncedAt || Date.now() - new Date(current.syncedAt).getTime() > 864e5);

  return (
    <>
      <div className="mobile-top">
        {switcher}
        <button className="btn btn-quiet btn-sm" onClick={() => setSheet(true)} aria-label="Menu"><Icon d={I.menu} /></button>
      </div>

      {sheet && <div className="sheet-backdrop" onClick={() => setSheet(false)} />}
      <aside className={`sidebar${sheet ? " open" : ""}`}>
        <Link href="/overview" className="brand">
          <span className="brand-dot" aria-hidden />
          Fortress HQ
        </Link>

        <div className="switcher">{switcher}</div>
        {current && (
          <div className="side-sync">
            <span>Synced {ago(current.syncedAt)}</span>
            <span aria-hidden>·</span>
            <button className="link-quiet" style={stale ? { color: "var(--blue)", fontWeight: 600 } : undefined} onClick={sync} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync"}
            </button>
          </div>
        )}

        {clientId ? (
          <>
            <nav className="side-nav" style={{ marginTop: 10 }}>{work.map(link)}</nav>
            <div className="side-label label">Sources</div>
            <nav className="side-nav">
              {groups.filter((g) => g.connected).map((g) => <SideGroup key={`${g.key}-${openGroup}`} group={g} open={openGroup === g.key} link={link} />)}
              {groups.filter((g) => !g.connected).map((g) => (
                <div key={g.key} className="side-muted">
                  <Icon d={g.icon} />{g.title}
                  <Link href={`${base}/settings` as never}>Connect →</Link>
                </div>
              ))}
            </nav>
          </>
        ) : (
          <>
            <div className="side-label label">Portfolio</div>
            <nav className="side-nav">
              {link({ href: "/overview", label: "All projects", icon: I.overview })}
              {link({ href: "/clients", label: "Add or manage projects", icon: I.clients, exact: true })}
              {link({ href: "/connect", label: "Connections", icon: I.connect })}
            </nav>
          </>
        )}

        <div className="side-foot">
          {clientId && link({ href: `${base}/settings`, label: "Project settings", icon: I.settings })}
          {admin && (
            <>
              {link({ href: "/admin/brain", label: "Brain", icon: I.brain })}
              {link({ href: "/admin/users", label: "People & access", icon: I.people })}
            </>
          )}
          <div className="side-account">
            <span title={email ?? undefined}>{email ?? "Signed in"}</span>
          </div>
          <SignOut identity={identity}><Icon d={I.out} />Sign out</SignOut>
        </div>
      </aside>

      {clientId && (
        <nav className="bottom-bar" aria-label="Main">
          <Link href={base as never} className={path === base ? "active" : undefined}><Icon d={I.overview} />Overview</Link>
          <Link href={`${base}/insights` as never} className={active(`${base}/insights`) ? "active" : undefined}>
            <Icon d={I.change} />To change{current?.urgent ? <span className="badge bad">{current.urgent}</span> : null}
          </Link>
          <Link href={`${base}/tag-manager` as never} className={active(`${base}/tag-manager`) || active(`${base}/tracking`) ? "active" : undefined}><Icon d={I.tracking} />Tracking</Link>
          <button onClick={() => window.dispatchEvent(new Event("fortress:ask"))}><Icon d={I.ask} />Ask</button>
        </nav>
      )}

      {palette && <Palette clients={clients} current={current} admin={admin} onClose={() => setPalette(false)} />}
    </>
  );
}

function SideGroup({ group, open: initial, link }: { group: Group; open: boolean; link: (l: NavLink) => React.ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <div>
      <button className="side-group" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg className="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M6 4l4 4-4 4" /></svg>
        {group.title}
        {group.count ? <span className="badge bad">{group.count}</span> : null}
      </button>
      {open && <div className="side-children">{group.links.map(link)}</div>}
    </div>
  );
}
