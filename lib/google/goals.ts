import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { mutate, searchStream, digits, AdsError } from "./ads";
import { countOps, gtmPace } from "./quota";
import { connectionForClient, clientFor } from "./auth";
import { clientWithProperties, type ClientWithProps } from "@/lib/binding";
import { q, q1 } from "@/lib/db";

/**
 * Creating a conversion goal, end to end.
 *
 * The signal that feeds Smart Bidding is created natively in Google Ads and
 * fired from Tag Manager, browser straight to Ads. It is deliberately NOT
 * routed through GA4: an imported GA4 key event arrives up to a day late
 * wearing GA4's last-non-direct session attribution rather than Ads' click
 * attribution, and bidding is a feedback loop that should not be fed stale
 * numbers measured by a different rule.
 *
 * Nothing here publishes. The GTM work lands in a workspace and waits for a
 * human, because publishing a container is a change to a live website.
 */

/** The categories worth offering. The enum has more; most are not web goals. */
export const CATEGORIES = [
  { value: "SUBMIT_LEAD_FORM", label: "Lead form submitted", counting: "ONE_PER_CLICK" },
  { value: "PHONE_CALL_LEAD", label: "Someone taps the phone number", counting: "ONE_PER_CLICK" },
  { value: "REQUEST_QUOTE", label: "Quote requested", counting: "ONE_PER_CLICK" },
  { value: "BOOK_APPOINTMENT", label: "Appointment booked", counting: "ONE_PER_CLICK" },
  { value: "CONTACT", label: "Contact (call or message)", counting: "ONE_PER_CLICK" },
  { value: "SIGNUP", label: "Sign-up", counting: "ONE_PER_CLICK" },
  { value: "PURCHASE", label: "Purchase", counting: "MANY_PER_CLICK" },
  { value: "ADD_TO_CART", label: "Added to cart", counting: "MANY_PER_CLICK" },
  { value: "BEGIN_CHECKOUT", label: "Checkout started", counting: "MANY_PER_CLICK" },
  { value: "DOWNLOAD", label: "Download", counting: "ONE_PER_CLICK" },
  { value: "PAGE_VIEW", label: "Page view", counting: "ONE_PER_CLICK" },
] as const;

export type GoalTrigger =
  | { kind: "url"; match: "contains" | "equals" | "startsWith"; value: string }
  | { kind: "event"; value: string }
  // A tap or click on any tel: link. Counts taps, not calls — the only native
  // phone signal in countries without Google forwarding numbers.
  | { kind: "phone"; value?: string };

export type GoalSpec = {
  name: string;
  category: string;
  /** True puts it in the Conversions column, which is what bidding optimises. */
  isPrimary: boolean;
  countingType: "ONE_PER_CLICK" | "MANY_PER_CLICK";
  defaultValue?: number | null;
  clickWindowDays?: number;
  viewWindowDays?: number;
  trigger: GoalTrigger;
  /** Off means create the Ads action only and hand back the snippet. */
  createGtmTag: boolean;
};

export type GoalResult = {
  goalId: number;
  actionId: string;
  resourceName: string;
  conversionId: string | null;
  conversionLabel: string | null;
  eventSnippet: string | null;
  gtm: {
    workspaceId: string; triggerId: string; tagId: string; containerId: string;
    linkerCreated: boolean; ga4TagId: string | null;
  } | null;
  /** A Tag Manager import file for the same tags, for review or for a container Fortress cannot write to. */
  importFile: unknown | null;
  warnings: string[];
};

/** Everything that must be true before a write is attempted. */
export async function preflight(clientId: number) {
  const client = await clientWithProperties(clientId);
  if (!client) throw new Error(`No client ${clientId}`);

  const existing = client.ads_customer_id
    ? await q<{ name: string; category: string; include_in_conversions: boolean }>(
        `SELECT name, category, include_in_conversions
           FROM conversion_actions WHERE client_id = $1 AND status <> 'REMOVED'
          ORDER BY name`,
        [clientId]
      )
    : [];

  return {
    client,
    canWriteAds: Boolean(client.ads_customer_id),
    canWriteGtm: Boolean(client.gtm_container_id),
    existing,
  };
}

export async function createGoal(clientId: number, spec: GoalSpec): Promise<GoalResult> {
  const conn = await connectionForClient(clientId);
  if (!conn) throw new Error("No active Google connection.");
  const auth = await clientFor(conn.id);

  const client = await clientWithProperties(clientId);
  if (!client) throw new Error(`No client ${clientId}`);
  if (!client.ads_customer_id) throw new Error("This client has no Google Ads account bound.");

  const name = spec.name.trim();
  if (!name) throw new Error("A goal needs a name.");

  const warnings: string[] = [];

  // A duplicate conversion action is not a cosmetic problem. Two actions
  // counting the same event, both primary, double every number the bidder
  // sees. Google will happily create the second one.
  await assertNameIsFree(auth, client, name);

  const created = await createAdsAction(auth, client, spec, name);
  const snippet = await readSnippet(auth, client, created.resourceName);

  if (!snippet.conversionId || !snippet.label) {
    warnings.push(
      "Google did not return a tag snippet for this action yet. It usually appears within a " +
        "few minutes; the Tag Manager tag cannot be built until it does."
    );
  }

  const measurementId = client.ga4_property_id
    ? await ga4MeasurementId(auth, client.ga4_property_id).catch(() => null)
    : null;

  let gtm: GoalResult["gtm"] = null;
  if (spec.createGtmTag) {
    if (!client.gtm_container_id) {
      warnings.push("No Tag Manager container is bound to this client, so no tag was created.");
    } else if (!snippet.conversionId || !snippet.label) {
      warnings.push("Skipped the Tag Manager tag because the conversion label is not available yet.");
    } else {
      gtm = await createGtmTag(auth, client, spec, name, snippet.conversionId, snippet.label, measurementId);
    }
  }

  const importFile = snippet.conversionId && snippet.label
    ? gtmImportFile({ name, trigger: spec.trigger, value: spec.defaultValue ?? null,
        conversionId: snippet.conversionId, label: snippet.label, measurementId })
    : null;

  if (spec.isPrimary) {
    warnings.push(
      "This action is primary, so it will start influencing Smart Bidding as soon as it " +
        "records conversions. Until the tag is published it will record none."
    );
  }

  const row = await q1<{ id: number }>(
    `INSERT INTO conversion_goals
       (client_id, name, category, counting_type, is_primary, default_value,
        ads_customer_id, ads_action_id, ads_resource_name, conversion_id, conversion_label,
        trigger_kind, trigger_match, trigger_value,
        gtm_container_id, gtm_workspace_id, gtm_trigger_id, gtm_tag_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id`,
    [
      clientId, name, spec.category, spec.countingType, spec.isPrimary,
      spec.defaultValue ?? null,
      client.ads_customer_id, created.actionId, created.resourceName,
      snippet.conversionId, snippet.label,
      spec.trigger.kind, spec.trigger.kind === "url" ? spec.trigger.match : null,
      spec.trigger.value,
      gtm?.containerId ?? null, gtm?.workspaceId ?? null,
      gtm?.triggerId ?? null, gtm?.tagId ?? null,
    ]
  );

  return {
    goalId: row!.id,
    actionId: created.actionId,
    resourceName: created.resourceName,
    conversionId: snippet.conversionId,
    conversionLabel: snippet.label,
    eventSnippet: snippet.eventSnippet,
    gtm,
    importFile,
    warnings,
  };
}

// ------------------------------------------------------------------ ads -----

async function assertNameIsFree(auth: OAuth2Client, client: ClientWithProps, name: string) {
  const rows = await searchStream(
    auth,
    client.ads_customer_id!,
    `SELECT conversion_action.name FROM conversion_action
      WHERE conversion_action.status != 'REMOVED'`
  );
  const clash = rows.find(
    (r) => String(r.conversionAction?.name ?? "").toLowerCase() === name.toLowerCase()
  );
  if (clash) {
    throw new Error(
      `A conversion action named "${name}" already exists in this account. ` +
        `Two actions counting the same event will double-count if both are primary.`
    );
  }
}

async function createAdsAction(
  auth: OAuth2Client,
  client: ClientWithProps,
  spec: GoalSpec,
  name: string
) {
  const create: Record<string, unknown> = {
    name,
    type: "WEBPAGE",
    category: spec.category,
    status: "ENABLED",
    // The API field for primary/secondary. False still records the conversion,
    // it just keeps it out of the column bidding reads.
    primaryForGoal: spec.isPrimary,
    countingType: spec.countingType,
    clickThroughLookbackWindowDays: spec.clickWindowDays ?? 30,
    viewThroughLookbackWindowDays: spec.viewWindowDays ?? 1,
  };

  if (spec.defaultValue != null) {
    create.valueSettings = {
      defaultValue: spec.defaultValue,
      alwaysUseDefaultValue: true,
    };
  }

  let results;
  try {
    results = await mutate(
      auth,
      client.ads_customer_id!,
      "conversionActions",
      [{ create }]
    );
  } catch (err) {
    if (err instanceof AdsError && err.errorCode === "USER_PERMISSION_DENIED") {
      throw new Error(
        "This credential can read the account but not write to it. Conversion actions " +
          "need standard access, not read-only."
      );
    }
    throw err;
  }

  const resourceName = results[0]?.resourceName;
  if (!resourceName) throw new Error("Google accepted the write but returned no resource name.");
  return { resourceName, actionId: resourceName.split("/").pop()! };
}

/**
 * The conversion id and label, which only exist on a read.
 *
 * The event snippet carries them inside a gtag call as
 * `'send_to': 'AW-123456789/AbC-dEf...'`, and there is no separate field for
 * either half, so it has to be parsed out.
 */
async function readSnippet(auth: OAuth2Client, client: ClientWithProps, resourceName: string) {
  const rows = await searchStream(
    auth,
    client.ads_customer_id!,
    `SELECT conversion_action.id, conversion_action.tag_snippets
       FROM conversion_action
      WHERE conversion_action.resource_name = '${resourceName}'`
  );

  const snippets = (rows[0]?.conversionAction?.tagSnippets ?? []) as {
    type?: string;
    pageFormat?: string;
    eventSnippet?: string;
  }[];

  const web = snippets.find((s) => s.pageFormat === "HTML") ?? snippets[0];
  const eventSnippet = web?.eventSnippet ?? null;

  const m = eventSnippet?.match(/['"]send_to['"]\s*:\s*['"](AW-\d+)\/([\w-]+)['"]/);
  return {
    eventSnippet,
    conversionId: m?.[1] ?? null,
    label: m?.[2] ?? null,
  };
}

// ------------------------------------------------------------------ gtm -----

async function createGtmTag(
  auth: OAuth2Client,
  client: ClientWithProps,
  spec: GoalSpec,
  name: string,
  conversionId: string,
  label: string,
  measurementId: string | null
) {
  const gtm = google.tagmanager({ version: "v2", auth });

  const inv = await q1<{ parent_id: string; provider_id: string }>(
    `SELECT i.parent_id, i.provider_id FROM inventory i
       JOIN client_properties cp ON cp.inventory_id = i.id
      WHERE cp.client_id = $1 AND cp.provider = 'gtm'`,
    [client.id]
  );
  if (!inv) throw new Error("No Tag Manager container bound to this client.");

  const containerPath = `accounts/${inv.parent_id}/containers/${inv.provider_id}`;

  // Work in the default workspace. Creating our own would be tidier but would
  // strand the change behind a workspace nobody opens.
  const ws = await gtm.accounts.containers.workspaces.list({ parent: containerPath });
  await countOps("gtm", 1);
  await gtmPace();

  const workspace =
    ws.data.workspace?.find((w) => w.name === "Default Workspace") ?? ws.data.workspace?.[0];
  if (!workspace?.workspaceId) throw new Error("This container has no workspace to write into.");
  const wsPath = `${containerPath}/workspaces/${workspace.workspaceId}`;

  // A click trigger reads {{Click URL}}, a built-in variable that is off in a
  // new container. Enabling one that is already on is refused; that is fine.
  if (spec.trigger.kind === "phone") {
    await gtm.accounts.containers.workspaces.built_in_variables
      .create({ parent: wsPath, type: ["clickUrl"] })
      .catch(() => undefined);
    await countOps("gtm", 1);
    await gtmPace();
  }

  const trigger = await gtm.accounts.containers.workspaces.triggers.create({
    parent: wsPath,
    requestBody: triggerBody(spec.trigger, name),
  });
  await countOps("gtm", 1);
  await gtmPace();

  const parameter: { type: string; key: string; value: string }[] = [
    // The tag wants the number only, without the AW- prefix.
    { type: "template", key: "conversionId", value: conversionId.replace(/^AW-/, "") },
    { type: "template", key: "conversionLabel", value: label },
    { type: "boolean", key: "enableConversionLinker", value: "true" },
  ];
  if (spec.defaultValue != null) {
    parameter.push({ type: "template", key: "conversionValue", value: String(spec.defaultValue) });
  }

  const tag = await gtm.accounts.containers.workspaces.tags.create({
    parent: wsPath,
    requestBody: {
      name: `Google Ads — ${name}`,
      type: "awct",
      parameter,
      firingTriggerId: [String(trigger.data.triggerId)],
      notes: "Created by Fortress. Review and publish in Tag Manager.",
    },
  });
  await countOps("gtm", 1);
  await gtmPace();

  // The conversion linker. Without it ad clicks lose their click identifier on
  // cross-domain and Safari journeys, and conversions that happened never get
  // attributed. Added only if the workspace has none.
  const existing = await gtm.accounts.containers.workspaces.tags.list({ parent: wsPath });
  await countOps("gtm", 1);
  await gtmPace();
  let linkerCreated = false;
  if (!(existing.data.tag ?? []).some((t) => t.type === "gclidw")) {
    await gtm.accounts.containers.workspaces.tags.create({
      parent: wsPath,
      requestBody: {
        name: "Conversion Linker",
        type: "gclidw",
        parameter: [
          { type: "boolean", key: "enableCrossDomain", value: "false" },
          { type: "boolean", key: "enableUrlPassthrough", value: "false" },
          { type: "boolean", key: "enableCookieOverrides", value: "false" },
        ],
        firingTriggerId: [ALL_PAGES],
        notes: "Created by Fortress.",
      },
    });
    await countOps("gtm", 1);
    await gtmPace();
    linkerCreated = true;
  }

  // The matching Analytics event, for analysis only. It is not what bidding
  // reads — the Ads tag above is — so importing it into Ads as a second primary
  // action would double-count.
  let ga4TagId: string | null = null;
  if (measurementId) {
    const ga4 = await gtm.accounts.containers.workspaces.tags.create({
      parent: wsPath,
      requestBody: {
        name: `GA4 event — ${name}`,
        type: "gaawe",
        parameter: [
          { type: "template", key: "eventName", value: eventName(name) },
          { type: "template", key: "measurementIdOverride", value: measurementId },
        ],
        firingTriggerId: [String(trigger.data.triggerId)],
        notes: "Created by Fortress. For Analytics reporting — do not import into Google Ads as a second primary action.",
      },
    }).catch(() => null);
    await countOps("gtm", 1);
    ga4TagId = ga4?.data.tagId ? String(ga4.data.tagId) : null;
  }

  return {
    containerId: inv.provider_id,
    workspaceId: String(workspace.workspaceId),
    triggerId: String(trigger.data.triggerId),
    tagId: String(tag.data.tagId),
    linkerCreated,
    ga4TagId,
  };
}

/** Tag Manager's built-in "All Pages" trigger. */
const ALL_PAGES = "2147479553";

/** A GA4-safe event name: lowercase, underscores, 40 characters. */
export function eventName(name: string): string {
  const base = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return (/^[a-z]/.test(base) ? base : `goal_${base}`).slice(0, 40) || "fortress_goal";
}

/** The web stream measurement ID (G-…) for a GA4 property. */
export async function ga4MeasurementId(auth: OAuth2Client, propertyId: string): Promise<string | null> {
  const admin = google.analyticsadmin({ version: "v1beta", auth });
  const res = await admin.properties.dataStreams.list({ parent: `properties/${digits(propertyId)}` });
  await countOps("ga4", 1);
  const web = (res.data.dataStreams ?? []).find((s) => s.type === "WEB_DATA_STREAM");
  return web?.webStreamData?.measurementId ?? null;
}

/**
 * A Tag Manager container import file holding the same tags: the Ads
 * conversion tag, the conversion linker, the GA4 event and the trigger. Import
 * it with "Merge" so nothing existing is overwritten, and every tag can be
 * reviewed before it goes live.
 */
export function gtmImportFile(o: {
  name: string; trigger: GoalTrigger; value: number | null;
  conversionId: string; label: string; measurementId: string | null;
}) {
  const ids = { account: "0", container: "0" };
  const base = { accountId: ids.account, containerId: ids.container };
  const trig = { ...base, triggerId: "1", ...triggerBody(o.trigger, o.name) };
  const tags: any[] = [
    {
      ...base, tagId: "1", name: `Google Ads — ${o.name}`, type: "awct",
      parameter: [
        { type: "TEMPLATE", key: "conversionId", value: o.conversionId.replace(/^AW-/, "") },
        { type: "TEMPLATE", key: "conversionLabel", value: o.label },
        ...(o.value != null ? [{ type: "TEMPLATE", key: "conversionValue", value: String(o.value) }] : []),
      ],
      firingTriggerId: ["1"], tagFiringOption: "ONCE_PER_EVENT",
    },
    {
      ...base, tagId: "2", name: "Conversion Linker", type: "gclidw",
      parameter: [
        { type: "BOOLEAN", key: "enableCrossDomain", value: "false" },
        { type: "BOOLEAN", key: "enableUrlPassthrough", value: "false" },
        { type: "BOOLEAN", key: "enableCookieOverrides", value: "false" },
      ],
      firingTriggerId: [ALL_PAGES], tagFiringOption: "ONCE_PER_EVENT",
    },
  ];
  if (o.measurementId) {
    tags.push({
      ...base, tagId: "3", name: `GA4 event — ${o.name}`, type: "gaawe",
      parameter: [
        { type: "TEMPLATE", key: "eventName", value: eventName(o.name) },
        { type: "TEMPLATE", key: "measurementIdOverride", value: o.measurementId },
      ],
      firingTriggerId: ["1"], tagFiringOption: "ONCE_PER_EVENT",
    });
  }
  const builtIn = [
    { ...base, type: "PAGE_URL", name: "Page URL" },
    { ...base, type: "EVENT", name: "Event" },
    ...(o.trigger.kind === "phone" ? [{ ...base, type: "CLICK_URL", name: "Click URL" }] : []),
  ];
  return {
    exportFormatVersion: 2,
    exportTime: new Date().toISOString().replace("T", " ").slice(0, 19),
    containerVersion: {
      path: "accounts/0/containers/0/versions/0", ...base, containerVersionId: "0",
      container: { path: "accounts/0/containers/0", ...base, name: "Fortress import", usageContext: ["WEB"] },
      tag: tags, trigger: [upper(trig)], builtInVariable: builtIn,
    },
  };
}

/** The import format spells parameter types in capitals. */
function upper(t: any): any {
  const fix = (ps: any[]) => ps.map((x) => ({ ...x, type: String(x.type).toUpperCase() }));
  const out = { ...t, type: String(t.type).toUpperCase().replace("CUSTOMEVENT", "CUSTOM_EVENT").replace("LINKCLICK", "LINK_CLICK") };
  for (const k of ["filter", "customEventFilter"]) if (out[k]) out[k] = out[k].map((f: any) => ({ ...f, type: camelToUpper(f.type), parameter: fix(f.parameter) }));
  return out;
}
const camelToUpper = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();

function triggerBody(trigger: GoalTrigger, name: string) {
  if (trigger.kind === "phone") {
    return {
      name: `Fortress — ${name} (phone tap)`,
      type: "linkClick",
      waitForTags: { type: "boolean", key: "waitForTags", value: "false" },
      checkValidation: { type: "boolean", key: "checkValidation", value: "false" },
      filter: [
        {
          type: "startsWith",
          parameter: [
            { type: "template", key: "arg0", value: "{{Click URL}}" },
            { type: "template", key: "arg1", value: "tel:" },
          ],
        },
      ],
    };
  }
  if (trigger.kind === "event") {
    return {
      name: `Fortress — ${name} (event)`,
      type: "customEvent",
      customEventFilter: [
        {
          type: "equals",
          parameter: [
            { type: "template", key: "arg0", value: "{{_event}}" },
            { type: "template", key: "arg1", value: trigger.value },
          ],
        },
      ],
    };
  }

  const op =
    trigger.match === "equals" ? "equals" : trigger.match === "startsWith" ? "startsWith" : "contains";

  return {
    name: `Fortress — ${name} (page)`,
    type: "pageview",
    filter: [
      {
        type: op,
        parameter: [
          { type: "template", key: "arg0", value: "{{Page URL}}" },
          { type: "template", key: "arg1", value: trigger.value },
        ],
      },
    ],
  };
}
