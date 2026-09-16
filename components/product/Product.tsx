import Link from "next/link";
import type { Finding } from "@/lib/engine/findings";
import { EvidenceTable } from "@/components/ui/bits";
import { JobButton } from "@/components/ui/JobButtons";
import { ago, PRODUCT_LABEL } from "@/lib/format";

export { PRODUCT_LABEL };


export function ProductHead({ product, title, clientId, meta, children }: {
  product: string; title: string; clientId: number; meta?: string | null; children?: React.ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <div className="label eyebrow">{PRODUCT_LABEL[product] ?? product}</div>
        <h1>{title}</h1>
        {meta && <p className="meta">{meta}</p>}
      </div>
      <div className="row">
        {children}
        <JobButton clientId={clientId} job="sync" label="Sync now" busyLabel="Pulling…" />
      </div>
    </header>
  );
}

/** The product is not bound to this project: say what it would add, and where to bind it. */
export function NotConnected({ product, clientId, adds }: { product: string; clientId: number; adds: string }) {
  return (
    <div className="card card-pad">
      <div className="empty">
        <h3>{PRODUCT_LABEL[product]} is not connected to this project</h3>
        <p style={{ maxWidth: 480, margin: "0 auto 16px" }}>{adds}</p>
        <Link href={`/clients/${clientId}/settings` as never} className="btn btn-primary">Choose one in project settings</Link>
      </div>
    </div>
  );
}

export function NoDataYet({ clientId, what }: { clientId: number; what: string }) {
  return (
    <div className="card card-pad">
      <div className="empty">
        <h3>Nothing pulled yet</h3>
        <p style={{ maxWidth: 460, margin: "0 auto 16px" }}>{what}</p>
        <JobButton clientId={clientId} job="sync" label="Sync now" busyLabel="Pulling…" primary />
      </div>
    </div>
  );
}

const TONE = { critical: "bad", warning: "warn", info: "info" } as const;

/** Measured findings, each with its table one click away. */
export function FindingList({ findings, title = "What stands out", none }: { findings: Finding[]; title?: string; none: string }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>{title}</h2>
        <span className="meta">Measured from the data; nothing here is written by the AI.</span>
      </div>
      {findings.length ? (
        <ul className="audit">
          {findings.map((f) => (
            <li key={f.kind + (f.entityId ?? "")} className={TONE[f.severity]}>
              <span className="mark">{f.severity === "critical" ? "!" : f.severity === "warning" ? "▲" : "i"}</span>
              <div className="body" style={{ minWidth: 0, flex: 1 }}>
                <h4>{f.title}</h4>
                <p className="meta">{f.detail}</p>
                {f.table?.rows?.length ? (
                  <details style={{ marginTop: 8 }}>
                    <summary className="meta" style={{ cursor: "pointer" }}>Show the {f.table.rows.length} row{f.table.rows.length === 1 ? "" : "s"}</summary>
                    <div style={{ marginTop: 8 }}><EvidenceTable table={f.table} /></div>
                  </details>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card-pad"><p className="meta">{none}</p></div>
      )}
    </div>
  );
}

export const syncedMeta = (at: string | Date | null | undefined, window: string) => `${window} · synced ${ago(at)}`;
