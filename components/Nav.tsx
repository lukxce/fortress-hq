"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/overview", label: "Overview" },
  { href: "/connect", label: "Connect" },
] as const;

export function Nav() {
  const path = usePathname();
  const router = useRouter();

  // The gate has no chrome.
  // Public pages carry their own chrome.
  if (path === "/login" || path === "/" || path === "/privacy.html") return null;

  async function signOut() {
    await fetch("/api/login", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <nav className="nav sheet">
      <Link href="/overview" className="wordmark">
        Fortress<span>hq</span>
      </Link>

      <div className="nav-links">
        {LINKS.map((l) => {
          const active = path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} className={`nav-link${active ? " active" : ""}`}>
              {l.label}
            </Link>
          );
        })}
      </div>

      <button className="btn btn-quiet btn-sm nav-out" onClick={signOut}>
        Sign out
      </button>
    </nav>
  );
}
