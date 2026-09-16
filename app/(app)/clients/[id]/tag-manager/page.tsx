import Link from "next/link";
import { q } from "@/lib/db";
import { pageClient } from "@/lib/page";
import { tagManager } from "@/lib/engine/products";
import { dateShort } from "@/lib/format";
import { DataTable } from "@/components/ui/DataTable";
import { ProductHead, NotConnected, NoDataYet, FindingList, syncedMeta } from "@/components/product/Product";

export const dynamic = "force-dynamic";

const TAG_TYPE: Record<string, string> = {
  googtag: "Google tag", gaawc: "Google tag (old)", gaawe: "GA4 event", awct: "Ads conversion", gclidw: "Conversion linker",
  sp: "Ads remarketing", html: "Custom HTML", img: "Custom image", flc: "Floodlight counter", fls: "Floodlight sales",
  baut: "Microsoft Ads", cvt_: "Template",
};
const typeLabel = (t: string | null) => (t ? TAG_TYPE[t] ?? (t.startsWith("cvt_") ? "Community template" : t) : "—");

export default async function TagManagerPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await pageClient(params);
  if (!client.gtm_container_id) {
    return (
      <div className="stack rise">
        <ProductHead product="tag_manager" title="Tags and health" clientId={client.id} />
        <NotConnected product="tag_manager" clientId={client.id} adds="Tag Manager is where tracking actually lives. Connected, it shows duplicate Google tags, tags nothing can fire, and when a container change lines up with a drop in conversions." />
      </div>
    );
  }
  const [tags, triggers, versions, findings] = await Promise.all([
    q<any>(`SELECT tag_id, name, type, paused, firing_triggers, consent_status, parameters, synced_at FROM gtm_tags WHERE client_id = $1`, [client.id]),
    q<any>(`SELECT trigger_id, name, type FROM gtm_triggers WHERE client_id = $1`, [client.id]),
    q<any>(`SELECT version_id, version_name, tag_count, first_seen FROM gtm_snapshots WHERE client_id = $1 ORDER BY first_seen DESC LIMIT 8`, [client.id]),
    tagManager(client.id),
  ]);
  if (!tags.length) {
    return (
      <div className="stack rise">
        <ProductHead product="tag_manager" title="Tags and health" clientId={client.id} />
        <NoDataYet clientId={client.id} what="Sync reads the live container: every tag, what it points at and what fires it." />
      </div>
    );
  }
  const triggerName = new Map(triggers.map((t) => [String(t.trigger_id), t.name]));
  const builtIn: Record<string, string> = { "2147479553": "All Pages", "2147479572": "Initialization", "2147479573": "Consent Initialization" };
  const rows = tags.map((t) => ({
    name: t.name,
    type: typeLabel(t.type),
    target: t.parameters?.tagId ?? t.parameters?.measurementId ?? t.parameters?.conversionId ?? t.parameters?.eventName ?? null,
    status: t.paused ? "Paused" : "Live",
    firing: (t.firing_triggers ?? []).map((id: string) => builtIn[id] ?? triggerName.get(String(id)) ?? (triggers.length ? `missing trigger ${id}` : `trigger ${id}`)).join(", ") || "Nothing fires it",
    consent: t.consent_status === "notNeeded" ? "Not needed" : t.consent_status === "needed" ? "Needs consent" : "Not set",
  }));

  return (
    <div className="stack rise">
      <ProductHead product="tag_manager" title="Tags and health" clientId={client.id}
        meta={syncedMeta(tags[0]?.synced_at, `${client.gtm_container_id} · live version`)}>
        <Link href={`/clients/${client.id}/tracking` as never} className="btn">Conversion tracking</Link>
      </ProductHead>

      <FindingList findings={findings} none="The container has no duplicate Google tags, no tags that cannot fire, and has not changed recently." />

      <section className="stack" style={{ gap: 12 }}>
        <h2>Tags in the live container</h2>
        <DataTable
          search="Search tags…"
          filter={{ key: "type", label: "Type" }}
          columns={[
            { key: "name", label: "Tag", sub: "target" },
            { key: "type", label: "Type" },
            { key: "status", label: "Status" },
            { key: "firing", label: "Fired by" },
            { key: "consent", label: "Consent" },
          ]}
          rows={rows}
          initialSort={{ key: "name", dir: 1 }}
        />
      </section>

      <div className="card">
        <div className="card-head"><h2>Versions seen</h2><span className="meta">The date is when Fortress first saw a version live — within a day of publishing.</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Version</th><th>Name</th><th className="r">Tags</th><th>First seen live</th></tr></thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.version_id}>
                  <td className="num">{v.version_id}</td><td>{v.version_name || "—"}</td>
                  <td className="num r">{v.tag_count}</td><td>{dateShort(v.first_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
