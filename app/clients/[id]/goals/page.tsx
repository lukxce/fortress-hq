import Link from "next/link";
import { notFound } from "next/navigation";
import { q } from "@/lib/db";
import { preflight, CATEGORIES } from "@/lib/google/goals";
import { GoalComposer } from "@/components/GoalComposer";

export const dynamic = "force-dynamic";

export default async function GoalsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clientId = Number(id);
  if (!Number.isFinite(clientId)) notFound();

  const pre = await preflight(clientId).catch(() => null);
  if (!pre) notFound();

  const created = await q<any>(
    `SELECT id, name, category, is_primary, conversion_id, conversion_label,
            gtm_tag_id, gtm_published, created_at
       FROM conversion_goals WHERE client_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [clientId]
  );

  return (
    <>
      <p className="meta">
        <Link href={`/clients/${clientId}`}>← {pre.client.name}</Link>
      </p>
      <h1>Conversion goals</h1>

      {!pre.canWriteAds ? (
        <div className="sheet sheet-pad">
          <p>This client has no Google Ads account bound, so there is nothing to write to.</p>
        </div>
      ) : (
        <GoalComposer
          clientId={clientId}
          clientName={pre.client.name}
          categories={[...CATEGORIES]}
          existing={pre.existing}
          canWriteGtm={pre.canWriteGtm}
        />
      )}

      {created.length ? (
        <>
          <h2 style={{ marginTop: 34 }}>Created through Fortress</h2>
          <div className="sheet sheet-pad">
            <div className="table-wrap"><table>
              <thead>
                <tr><th>Name</th><th>Primary</th><th>Label</th><th>Tag Manager</th><th>When</th></tr>
              </thead>
              <tbody>
                {created.map((g) => (
                  <tr key={g.id}>
                    <td>{g.name}</td>
                    <td>{g.is_primary ? "Yes" : "No"}</td>
                    <td className="meta">{g.conversion_label ?? "—"}</td>
                    <td className="meta">
                      {g.gtm_tag_id
                        ? g.gtm_published ? "Published" : "Waiting to publish"
                        : "Not created"}
                    </td>
                    <td className="meta">{new Date(g.created_at).toLocaleDateString("en-GB")}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </>
      ) : null}

      <h2 style={{ marginTop: 34 }}>Already in the account</h2>
      <div className="sheet sheet-pad">
        {pre.existing.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Category</th><th>Feeds bidding</th></tr></thead>
            <tbody>
              {pre.existing.map((e) => (
                <tr key={e.name}>
                  <td>{e.name}</td>
                  <td className="meta">{e.category}</td>
                  <td>{e.include_in_conversions_metric ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : (
          <p className="meta">No conversion actions synced yet. Run a sync first.</p>
        )}
      </div>
    </>
  );
}
