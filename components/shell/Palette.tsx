"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ClientItem } from "./Sidebar";
import { ago } from "@/lib/format";

type Item = { id: string; group: string; label: string; sub?: string; href: string; dot?: string };

// Pages a project has, for jumping straight to one.
const PAGES: [string, string][] = [
  ["", "Overview"], ["/insights", "What to change"], ["/experiments", "Experiments"], ["/reports", "Reports"],
  ["/tag-manager", "Tags on the site"], ["/tracking", "Conversions"],
  ["/launch", "Launch a campaign"], ["/ads", "Campaigns"], ["/ads/copy", "Ads & copy"], ["/ads/search-terms", "Search terms & keywords"], ["/ads/keywords", "Keyword research"], ["/builder", "New campaign"],
  ["/analytics", "Traffic"], ["/analytics/pages", "Landing pages"], ["/analytics/events", "Events"],
  ["/search-console", "Organic searches"], ["/search-console/pages", "Search Console pages"], ["/search-console/opportunities", "Opportunities"],
  ["/website", "Page speed"], ["/settings", "Project settings"],
];

/** ⌘K: switch project (staying on the same page) or jump to a page. */
export function Palette({ clients, current, admin, onClose }: { clients: ClientItem[]; current: ClientItem | null; admin: boolean; onClose: () => void }) {
  const router = useRouter();
  const path = usePathname();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const rest = path.replace(/^\/clients\/\d+/, "");
  const items = useMemo<Item[]>(() => {
    const list: Item[] = [
      ...clients.map((c) => ({
        id: `p${c.id}`, group: "Projects", label: c.name,
        sub: `${c.urgent ? `${c.urgent} to do first · ` : ""}synced ${ago(c.syncedAt)}`,
        href: `/clients/${c.id}${current ? rest : ""}`, dot: c.urgent ? "bad" : "ok",
      })),
      ...(current ? PAGES.map(([suffix, label]) => ({ id: `g${suffix}`, group: current.name, label, href: `/clients/${current.id}${suffix}` })) : []),
      { id: "all", group: "Portfolio", label: "All projects", href: "/overview" },
      { id: "add", group: "Portfolio", label: "Add or manage projects", href: "/clients" },
      { id: "conn", group: "Portfolio", label: "Connections", href: "/connect" },
      ...(admin ? [
        { id: "brain", group: "Admin", label: "Brain", href: "/admin/brain" },
        { id: "people", group: "Admin", label: "People & access", href: "/admin/users" },
      ] : []),
    ];
    const q = query.trim().toLowerCase();
    return q ? list.filter((i) => `${i.label} ${i.group}`.toLowerCase().includes(q)) : list;
  }, [clients, current, admin, query, rest]);

  useEffect(() => { setIndex(0); }, [query]);

  const go = (i: Item | undefined) => { if (!i) return; onClose(); router.push(i.href as never); };

  let lastGroup = "";
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Switch project or go to a page" onMouseDown={(e) => e.stopPropagation()}>
        <input ref={input} type="search" placeholder="Search projects and pages…" value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(items.length - 1, i + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
            if (e.key === "Enter") go(items[index]);
          }} />
        <div className="palette-list">
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? <div className="palette-label">{it.group}</div> : null;
            lastGroup = it.group;
            return (
              <div key={it.id}>
                {head}
                <button className={`palette-item${i === index ? " active" : ""}`} onMouseEnter={() => setIndex(i)} onClick={() => go(it)}>
                  {it.dot && <span className={`dot ${it.dot}`} aria-hidden />}
                  {it.label}
                  {it.sub && <span className="sub">{it.sub}</span>}
                </button>
              </div>
            );
          })}
          {!items.length && <div className="palette-label">Nothing matches</div>}
        </div>
      </div>
    </div>
  );
}
