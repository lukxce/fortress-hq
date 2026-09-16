import type { TagCheck, TagStatus, Where } from "@/lib/tracking/tagcheck";
import { ago, dateShort } from "@/lib/format";
import { CheckTagsButton } from "./CheckTagsButton";

const STATUS: Record<TagStatus, { label: string; pill: string }> = {
  installed: { label: "On the site", pill: "pill-good" },
  via_tag_manager: { label: "On the site through Tag Manager", pill: "pill-good" },
  configured_not_live: { label: "In Tag Manager, not live on the site", pill: "pill-bad" },
  receiving_but_not_found: { label: "Not found, but data is arriving", pill: "pill-warn" },
  not_found: { label: "Not found on the site", pill: "pill-bad" },
  not_connected: { label: "Not connected", pill: "pill" },
};

const path = (u: string) => { try { const x = new URL(u); return x.pathname === "/" ? x.host : x.pathname; } catch { return u; } };

function how(w: Where, kind: "ads" | "analytics") {
  const parts: string[] = [];
  if (w.directOnPages.length) parts.push(`in the page code on ${w.directOnPages.map(path).join(", ")}`);
  if (w.inLiveContainer) parts.push("in the live Tag Manager container loaded by the site");
  if (w.inContainerTags && !w.inLiveContainer) parts.push("configured in the connected container, but that container is not what the site loads");
  if (!parts.length) return kind === "ads" ? "Not in the page code or in any container the site loads." : "Not in the page code or in any container the site loads.";
  return `Found ${parts.join("; and ")}.`;
}

export function TagOverview({ clientId, check, checkedAt, connected }: {
  clientId: number; check: TagCheck | null; checkedAt: string | null;
  connected: { ads: boolean; analytics: boolean; tagManager: boolean };
}) {
  const rows: { product: string; id: string | null; status: TagStatus; note: string; data: string }[] = check ? [
    {
      product: "Google Ads", id: check.ads?.id ?? null, status: check.ads ? check.ads.status : "not_connected",
      note: check.ads ? (check.ads.id ? how(check.ads.where, "ads") : check.idsUnavailable ? "Could not ask Google for the ID — see the note below." : "The account has no conversion tracking ID yet — no conversion action has been created.") : "Connect a Google Ads account in project settings.",
      data: check.ads?.lastConversionReceived ? `Last conversion ${dateShort(check.ads.lastConversionReceived)}` : check.ads ? "No conversion recorded recently" : "—",
    },
    {
      product: "Analytics", id: check.analytics?.id ?? null, status: check.analytics ? check.analytics.status : "not_connected",
      note: check.analytics ? (check.analytics.id ? how(check.analytics.where, "analytics") : check.idsUnavailable ? "Could not ask Google for the ID — see the note below." : "The property has no web data stream.") : "Connect an Analytics property in project settings.",
      data: check.analytics ? `${check.analytics.sessionsLast3Days.toLocaleString()} sessions, last 3 days` : "—",
    },
    {
      product: "Tag Manager", id: check.tagManager?.id ?? null, status: check.tagManager ? check.tagManager.status : "not_connected",
      note: check.tagManager
        ? (check.tagManager.where.directOnPages.length ? `Container snippet found on ${check.tagManager.where.directOnPages.map(path).join(", ")}.` : "The container snippet is not on the pages checked, so none of its tags run there.")
        : "Connect a Tag Manager container in project settings.",
      data: check.tagManager?.liveVersion ? `Live version ${check.tagManager.liveVersion}` : "—",
    },
  ] : [];

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Google tags on the website</h2>
          <p className="meta" style={{ margin: "2px 0 0" }}>
            {check ? <>IDs pulled from Google · {check.website ? <>checked {path(check.website)} and {Math.max(0, check.pages.length - 1)} landing page{check.pages.length === 2 ? "" : "s"} {ago(checkedAt)}</> : "no website known — add one in project settings"}</> : "Not checked yet"}
          </p>
        </div>
        <CheckTagsButton clientId={clientId} />
      </div>
      {check ? (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th>ID</th><th>On the site?</th><th>Google receiving</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.product}>
                    <td className="cell-name">{r.product}</td>
                    <td className="num">{r.id ?? "—"}</td>
                    <td><span className={`pill ${!r.id && check.idsUnavailable && r.status !== "not_connected" ? "pill" : STATUS[r.status].pill}`}>{!r.id && check.idsUnavailable && r.status !== "not_connected" ? "Unknown" : STATUS[r.status].label}</span><div className="cell-sub" style={{ maxWidth: 420, whiteSpace: "normal" }}>{r.note}</div></td>
                    <td className="meta">{r.data}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {check.ads?.actions.length ? (
            <div className="table-wrap" style={{ borderTop: "1px solid var(--line)" }}>
              <table>
                <thead><tr><th>Ads conversion action</th><th>Label</th><th>Label on the site?</th><th>Last received</th></tr></thead>
                <tbody>
                  {check.ads.actions.map((a) => (
                    <tr key={a.name}>
                      <td><div className="cell-name">{a.name}</div><div className="cell-sub">{a.primary ? "Primary — counts toward bidding" : "Secondary"}</div></td>
                      <td className="num">{a.label ?? "—"}</td>
                      <td>{a.found ? <span className="pill pill-good">Found</span> : <span className={`pill ${a.lastReceived ? "pill-warn" : "pill-bad"}`}>{a.lastReceived ? "Not found, still receiving" : "Not found"}</span>}</td>
                      <td className="meta">{a.lastReceived ? dateShort(a.lastReceived) : "never"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <ul className="audit" style={{ borderTop: "1px solid var(--line)" }}>
            {check.otherIdsOnSite.length > 0 && (
              <li className="warn"><span className="mark">!</span><div className="body"><h4>Other Google IDs on the site</h4>
                <p className="meta">{check.otherIdsOnSite.map((o) => `${o.id} (${o.kind})`).join(", ")}. Tags this project is not connected to: an old install, another agency&rsquo;s, or the right one bound to the wrong project.</p></div></li>
            )}
            {check.pages.filter((p) => !p.ok).map((p) => (
              <li key={p.url} className="warn"><span className="mark">!</span><div className="body"><h4>Could not read {path(p.url)}</h4>
                <p className="meta">{p.error ?? `The site answered ${p.status}`}. Anything on that page is unknown, not missing.</p></div></li>
            ))}
            {check.errors.map((e) => <li key={e} className="warn"><span className="mark">!</span><div className="body"><p className="meta">{e}</p></div></li>)}
            <li className="info"><span className="mark">i</span><div className="body"><p className="meta">
              {check.consentModeSeen ? "A consent banner or consent mode was detected. " : ""}Tags that load only after cookie consent, or through server-side Tag Manager on the site&rsquo;s own domain, cannot be seen from outside. When a tag is not found but Google is still receiving data, that is the likely reason.
            </p></div></li>
          </ul>
        </>
      ) : (
        <div className="card-pad"><p className="meta">Pulls the Google Ads conversion ID, the Analytics measurement ID and the Tag Manager container ID from Google, then reads the live website and container to see which are actually installed. Runs on every sync.</p></div>
      )}
    </div>
  );
}
