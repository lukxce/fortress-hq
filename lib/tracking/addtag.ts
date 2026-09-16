import { google } from "googleapis";
import { q, q1 } from "@/lib/db";
import { connectionForClient, clientFor } from "@/lib/google/auth";
import { countOps, gtmPace } from "@/lib/google/quota";
import type { TagCheck } from "./tagcheck";

/** Tag Manager's built-in "Initialization - All Pages": the Google tag belongs here, before any event tag. */
const INITIALIZATION = "2147479572";
const ALL_PAGES = "2147479553";

export type AddResult = { created: string[]; skipped: string[]; workspaceUrl: string; id: string };

/**
 * Put a missing Google tag into the project's Tag Manager container.
 *
 * Like every Tag Manager write in Fortress it lands in the workspace and is not
 * published: publishing changes a live website, so a person reviews it in Tag
 * Manager's preview first. If the workspace already has a Google tag for this
 * ID — added earlier and never published — nothing is created twice.
 */
export async function addGoogleTag(clientId: number, product: "ads" | "analytics"): Promise<AddResult> {
  const row = await q1<{ result: TagCheck }>(`SELECT result FROM tag_checks WHERE client_id = $1`, [clientId]);
  const check = row?.result;
  const id = product === "ads" ? check?.ads?.id : check?.analytics?.id;
  if (!id) throw new Error("Run the site check first, so the ID is known.");
  if (!check?.tagManager?.id || !check.tagManager.where.directOnPages.length) {
    throw new Error("The connected Tag Manager container is not on the website, so a tag added to it would not run. Use the code instead.");
  }

  const inv = await q1<{ parent_id: string; provider_id: string }>(
    `SELECT i.parent_id, i.provider_id FROM inventory i JOIN client_properties cp ON cp.inventory_id = i.id
      WHERE cp.client_id = $1 AND cp.provider = 'gtm'`, [clientId]);
  if (!inv) throw new Error("No Tag Manager container is connected to this project.");
  const conn = await connectionForClient(clientId);
  if (!conn) throw new Error("No Google connection.");
  const gtm = google.tagmanager({ version: "v2", auth: await clientFor(conn.id) });

  const containerPath = `accounts/${inv.parent_id}/containers/${inv.provider_id}`;
  const ws = await gtm.accounts.containers.workspaces.list({ parent: containerPath });
  await countOps("gtm", 1); await gtmPace();
  const workspace = ws.data.workspace?.find((w) => w.name === "Default Workspace") ?? ws.data.workspace?.[0];
  if (!workspace?.workspaceId) throw new Error("This container has no workspace to write into.");
  const wsPath = `${containerPath}/workspaces/${workspace.workspaceId}`;

  const existing = (await gtm.accounts.containers.workspaces.tags.list({ parent: wsPath })).data.tag ?? [];
  await countOps("gtm", 1); await gtmPace();

  const created: string[] = [], skipped: string[] = [];
  const hasGoogleTag = existing.some((t) => ["googtag", "gaawc"].includes(t.type ?? "") &&
    (t.parameter ?? []).some((p) => ["tagId", "measurementId"].includes(p.key ?? "") && p.value === id));

  if (hasGoogleTag) skipped.push(`A Google tag for ${id} is already in the workspace — it only needs publishing`);
  else {
    await gtm.accounts.containers.workspaces.tags.create({
      parent: wsPath,
      requestBody: {
        name: `Google tag — ${id}`,
        type: "googtag",
        parameter: [{ type: "template", key: "tagId", value: id }],
        firingTriggerId: [INITIALIZATION],
        notes: `Created by Fortress: ${product === "ads" ? "Google Ads" : "Analytics"} tag was not found on the website. Check in Preview, then publish.`,
      },
    });
    await countOps("gtm", 1); await gtmPace();
    created.push(`Google tag ${id} on every page`);
  }

  // Ads clicks lose their click ID on some journeys without the linker, and conversions go unattributed.
  if (product === "ads") {
    if (existing.some((t) => t.type === "gclidw")) skipped.push("Conversion linker already exists");
    else {
      await gtm.accounts.containers.workspaces.tags.create({
        parent: wsPath,
        requestBody: {
          name: "Conversion Linker", type: "gclidw",
          parameter: [
            { type: "boolean", key: "enableCrossDomain", value: "false" },
            { type: "boolean", key: "enableUrlPassthrough", value: "false" },
            { type: "boolean", key: "enableCookieOverrides", value: "false" },
          ],
          firingTriggerId: [ALL_PAGES], notes: "Created by Fortress.",
        },
      });
      await countOps("gtm", 1); await gtmPace();
      created.push("Conversion linker on every page");
    }
  }

  const workspaceUrl = `https://tagmanager.google.com/#/container/accounts/${inv.parent_id}/containers/${inv.provider_id}/workspaces/${workspace.workspaceId}`;
  await q(`UPDATE tag_checks SET result = jsonb_set(result, $2, $3::jsonb, true) WHERE client_id = $1`,
    [clientId, `{added,${product}}`, JSON.stringify({ at: new Date().toISOString(), created, skipped, workspaceUrl })]);
  return { created, skipped, workspaceUrl, id };
}

/** The code to paste into the site's <head> when there is no Tag Manager to add it to. */
export function gtagSnippet(ids: string[]): string {
  if (!ids.length) return "";
  return `<!-- Google tag -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${ids[0]}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
${ids.map((id) => `  gtag('config', '${id}');`).join("\n")}
</script>`;
}
