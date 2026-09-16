"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type ClientItem = { id: number; name: string; urgent: number };

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
};

function Icon({ d }: { d: React.ReactNode }) {
  return (
    <svg className="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d}
    </svg>
  );
}

export function Sidebar({ clients }: { clients: ClientItem[] }) {
  const path = usePathname();
  const router = useRouter();
  const match = path.match(/^\/clients\/(\d+)/);
  const clientId = match ? Number(match[1]) : null;
  const current = clients.find((c) => c.id === clientId) ?? null;

  const clientLinks = clientId
    ? [
        { href: `/clients/${clientId}`, label: "Overview", icon: I.overview, exact: true },
        { href: `/clients/${clientId}/insights`, label: "What to change", icon: I.change, count: current?.urgent },
        { href: `/clients/${clientId}/experiments`, label: "Experiments", icon: I.experiments },
        { href: `/clients/${clientId}/tracking`, label: "Conversion tracking", icon: I.tracking },
        { href: `/clients/${clientId}/builder`, label: "New campaign", icon: I.builder },
        { href: `/clients/${clientId}/reports`, label: "Reports", icon: I.reports },
        { href: `/clients/${clientId}/brain`, label: "Brain", icon: I.brain },
      ]
    : [];

  const active = (href: string, exact?: boolean) => (exact ? path === href : path === href || path.startsWith(`${href}/`));

  async function signOut() {
    await fetch("/api/login", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside className="sidebar">
      <Link href="/overview" className="brand">
        <span className="brand-dot" aria-hidden />
        Fortress HQ
      </Link>

      {clients.length > 0 && (
        <div className="switcher">
          <select
            aria-label="Client"
            value={clientId ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              if (!id) return router.push("/overview");
              // Stay on the same page for the new client where there is one.
              const rest = clientId ? path.replace(/^\/clients\/\d+/, "") : "";
              router.push(`/clients/${id}${rest}` as never);
            }}
          >
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {clientLinks.length > 0 && (
        <>
          <div className="side-label label">{current?.name ?? "Client"}</div>
          <nav className="side-nav">
            {clientLinks.map((l) => (
              <Link key={l.href} href={l.href as never} className={`side-link${active(l.href, l.exact) ? " active" : ""}`}>
                <Icon d={l.icon} />
                {l.label}
                {l.count ? <span className="count">{l.count}</span> : null}
              </Link>
            ))}
          </nav>
        </>
      )}

      <div className="side-label label">Portfolio</div>
      <nav className="side-nav">
        <Link href="/overview" className={`side-link${active("/overview") ? " active" : ""}`}><Icon d={I.overview} />All clients</Link>
        <Link href="/clients" className={`side-link${path === "/clients" ? " active" : ""}`}><Icon d={I.clients} />Add or manage clients</Link>
        <Link href="/connect" className={`side-link${active("/connect") ? " active" : ""}`}><Icon d={I.connect} />Connections</Link>
      </nav>

      <div className="side-foot">
        <button className="side-link" style={{ background: "none", border: 0, font: "inherit", cursor: "pointer", textAlign: "left" }} onClick={signOut}>
          <Icon d={I.out} />Sign out
        </button>
      </div>
    </aside>
  );
}
