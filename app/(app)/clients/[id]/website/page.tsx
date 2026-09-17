import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { speedFindings } from "@/lib/engine/extras";
import { ago } from "@/lib/format";
import { ProductHead, FindingList } from "@/components/product/Product";
import { CheckSpeedButton } from "@/components/website/CheckSpeedButton";

export const dynamic = "force-dynamic";

const path = (u: string) => { try { const x = new URL(u); return x.pathname === "/" ? x.host : x.pathname; } catch { return u; } };
const secs = (ms: number | null | undefined) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`);
const TONE: Record<string, string> = { FAST: "pill-good", AVERAGE: "pill-warn", SLOW: "pill-bad" };
const tone = (v: number | null | undefined, good: number, poor: number) => (v == null ? "" : v <= good ? "ok-text" : v > poor ? "bad-text" : "");

export default async function Website({ params }: { params: Promise<{ id: string }> }) {
  const client = await pageClient(params);
  const [rows, findings] = await Promise.all([
    q<any>(`SELECT * FROM page_speed WHERE client_id = $1 ORDER BY CASE role WHEN 'Home page' THEN 0 WHEN 'Paid landing page' THEN 1 ELSE 2 END, url, strategy DESC`, [client.id]),
    speedFindings(client.id),
  ]);
  const checked = rows[0]?.checked_at ?? null;

  return (
    <div className="stack rise">
      <ProductHead product="website" title="Page speed" clientId={client.id}
        meta={checked ? `PageSpeed Insights · checked ${ago(checked)} · rechecked weekly` : "PageSpeed Insights · not checked yet"}>
        <CheckSpeedButton clientId={client.id} />
      </ProductHead>

      <p className="lede" style={{ margin: 0 }}>
        The pages that matter here: the home page, where paid clicks land, and where organic search sends people. <strong>Real visitors</strong> is what Chrome users
        actually experienced over 28 days — what Google itself goes by — and exists only for pages with enough traffic; otherwise the whole site&rsquo;s figure is shown.
        The <strong>lab test</strong> is one simulated run on a slow phone.
      </p>

      <FindingList findings={findings} none={rows.length ? "No key page is slow enough on mobile to cost enquiries." : "Nothing checked yet."} />

      {rows.length ? (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Page</th><th className="r">Score</th>
                  <th>Real visitors</th><th className="r">Main content</th><th className="r">Layout shift</th><th className="r">Tap response</th>
                  <th className="r">Lab: main content</th><th>Biggest savings</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.url}-${r.strategy}`}>
                    <td>
                      <div className="cell-name" title={r.url}>{path(r.url)}</div>
                      <div className="cell-sub">{r.role} · {r.strategy}</div>
                      {r.error && <div className="cell-sub bad-text">{r.error}</div>}
                    </td>
                    <td className={`num r ${r.score == null ? "" : r.score >= 90 ? "ok-text" : r.score < 50 ? "bad-text" : ""}`}>{r.score ?? "—"}</td>
                    <td>{r.field ? <><span className={`pill ${TONE[r.field.overall] ?? ""}`}>{r.field.overall ?? "—"}</span><div className="cell-sub">{r.field_scope === "page" ? "this page" : "whole site"}</div></> : <span className="meta">not enough traffic</span>}</td>
                    <td className={`num r ${tone(r.field?.lcpMs, 2500, 4000)}`}>{secs(r.field?.lcpMs)}</td>
                    <td className={`num r ${tone(r.field?.cls, 0.1, 0.25)}`}>{r.field?.cls != null ? Number(r.field.cls).toFixed(2) : "—"}</td>
                    <td className={`num r ${tone(r.field?.inpMs, 200, 500)}`}>{r.field?.inpMs != null ? `${r.field.inpMs} ms` : "—"}</td>
                    <td className={`num r ${tone(r.lab?.lcpMs, 2500, 4000)}`}>{secs(r.lab?.lcpMs)}</td>
                    <td className="meta" style={{ maxWidth: 280, whiteSpace: "normal" }}>
                      {(r.opportunities ?? []).slice(0, 3).map((o: any) => `${o.title} (${secs(o.savingsMs)})`).join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card card-pad"><div className="empty"><h3>Not checked yet</h3><p>Runs weekly on its own, or now with the button above. A check takes a minute or two.</p></div></div>
      )}
    </div>
  );
}
