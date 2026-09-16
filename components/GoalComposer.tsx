"use client";

import { useState } from "react";

type Category = { value: string; label: string; counting: string };
type Existing = { name: string; category: string; include_in_conversions: boolean };

type Result = {
  goalId: number;
  actionId: string;
  conversionId: string | null;
  conversionLabel: string | null;
  eventSnippet: string | null;
  gtm: { workspaceId: string; triggerId: string; tagId: string; containerId: string } | null;
  warnings: string[];
};

export function GoalComposer({
  clientId,
  clientName,
  categories,
  existing,
  canWriteGtm,
}: {
  clientId: number;
  clientName: string;
  categories: Category[];
  existing: Existing[];
  canWriteGtm: boolean;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(categories[0]?.value ?? "SUBMIT_LEAD_FORM");
  const [isPrimary, setIsPrimary] = useState(false);
  const [triggerKind, setTriggerKind] = useState<"url" | "event">("url");
  const [match, setMatch] = useState<"contains" | "equals" | "startsWith">("contains");
  const [triggerValue, setTriggerValue] = useState("");
  const [value, setValue] = useState("");
  const [createGtmTag, setCreateGtmTag] = useState(canWriteGtm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const chosen = categories.find((c) => c.value === category);
  const counting = chosen?.counting === "MANY_PER_CLICK" ? "MANY_PER_CLICK" : "ONE_PER_CLICK";
  const primaryCount = existing.filter((e) => e.include_in_conversions).length;

  async function submit() {
    if (!name.trim()) return setError("Give the goal a name.");
    if (!triggerValue.trim()) return setError("Say when it should fire.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/goals?client=${clientId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          category,
          isPrimary,
          countingType: counting,
          defaultValue: value.trim() === "" ? null : Number(value),
          createGtmTag,
          trigger:
            triggerKind === "url"
              ? { kind: "url", match, value: triggerValue.trim() }
              : { kind: "event", value: triggerValue.trim() },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? "Could not create the goal.");
      setResult(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="sheet sheet-pad">
        <span className="beacon">Created</span>
        <h2 style={{ marginTop: 14 }}>{name}</h2>
        <p className="lede">
          The conversion action exists in Google Ads for {clientName}
          {result.conversionLabel ? ` as ${result.conversionId}/${result.conversionLabel}` : ""}.
        </p>

        {result.gtm ? (
          <p>
            A trigger and an Ads conversion tag were written into the container&rsquo;s default
            workspace. <strong>Nothing is live yet</strong> — open Tag Manager, check the tag, and
            publish. Until you do, this goal records nothing.
          </p>
        ) : (
          <p>
            No Tag Manager tag was created, so the snippet has to go on the site by hand.
          </p>
        )}

        {result.eventSnippet ? (
          <>
            <div className="label" style={{ marginTop: 18 }}>Event snippet</div>
            <pre className="snippet">{result.eventSnippet}</pre>
          </>
        ) : null}

        {result.warnings.map((w) => (
          <p key={w} className="meta" style={{ marginTop: 8 }}>{w}</p>
        ))}

        <div className="row" style={{ marginTop: 20 }}>
          <button className="btn btn-ghost" onClick={() => { setResult(null); setName(""); setTriggerValue(""); }}>
            Create another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sheet sheet-pad">
      <h2>New conversion goal</h2>
      <p className="lede">
        Created natively in Google Ads and fired from Tag Manager. The signal goes browser
        straight to Ads, not through Analytics — an imported GA4 key event arrives up to a day
        late and carries a different attribution model, and bidding is a feedback loop.
      </p>

      <div className="rule" />

      <div className="field">
        <label className="label" htmlFor="g-name">What is it called</label>
        <input id="g-name" type="text" value={name} placeholder="Quote form submitted"
               onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="field-row" style={{ marginTop: 14 }}>
        <div className="field">
          <label className="label" htmlFor="g-cat">What kind of action</label>
          <select id="g-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="g-val">Value, if it has one</label>
          <input id="g-val" type="number" value={value} placeholder="optional"
                 onChange={(e) => setValue(e.target.value)} />
        </div>
      </div>

      <p className="field-note meta">
        {counting === "ONE_PER_CLICK"
          ? "Counted once per click — the right choice for leads, where one person filling the form twice is still one lead."
          : "Counted every time — the right choice for sales, where a second purchase is genuinely a second conversion."}
      </p>

      <div className="rule" />

      <div className="label">When does it fire</div>
      <div className="row" style={{ marginTop: 8, marginBottom: 10 }}>
        <button type="button" className={`btn btn-sm ${triggerKind === "url" ? "btn-primary" : "btn-quiet"}`}
                onClick={() => setTriggerKind("url")}>A page is reached</button>
        <button type="button" className={`btn btn-sm ${triggerKind === "event" ? "btn-primary" : "btn-quiet"}`}
                onClick={() => setTriggerKind("event")}>A dataLayer event fires</button>
      </div>

      <div className="field-row">
        {triggerKind === "url" ? (
          <div className="field">
            <label className="label" htmlFor="g-match">URL</label>
            <select id="g-match" value={match} onChange={(e) => setMatch(e.target.value as typeof match)}>
              <option value="contains">contains</option>
              <option value="startsWith">starts with</option>
              <option value="equals">is exactly</option>
            </select>
          </div>
        ) : null}
        <div className="field" style={{ flex: 2 }}>
          <label className="label" htmlFor="g-trig">
            {triggerKind === "url" ? "this text" : "Event name"}
          </label>
          <input id="g-trig" type="text" value={triggerValue}
                 placeholder={triggerKind === "url" ? "/hvala" : "generate_lead"}
                 onChange={(e) => setTriggerValue(e.target.value)} />
        </div>
      </div>

      <div className="rule" />

      <label className="row" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
        <span>
          <strong>Make it primary</strong> — include it in the Conversions column, so Smart
          Bidding optimises toward it.
        </span>
      </label>
      <p className="field-note meta">
        {isPrimary
          ? `This account already has ${primaryCount} primary action${primaryCount === 1 ? "" : "s"}. Adding another changes what bidding chases, and a thin account can lose the volume each signal needs to stay reliable.`
          : "Left secondary it still records and still reports, it just does not steer bidding. That is the safer default until you have seen it count correctly."}
      </p>

      {canWriteGtm ? (
        <label className="row" style={{ cursor: "pointer", marginTop: 12 }}>
          <input type="checkbox" checked={createGtmTag}
                 onChange={(e) => setCreateGtmTag(e.target.checked)} />
          <span>Build the trigger and tag in Tag Manager, ready for me to publish</span>
        </label>
      ) : (
        <p className="meta" style={{ marginTop: 12 }}>
          No Tag Manager container is bound to this client, so you will get the snippet to place
          by hand.
        </p>
      )}

      {error ? <p className="err" style={{ marginTop: 14 }}>{error}</p> : null}

      <div className="row" style={{ marginTop: 20 }}>
        <button className="btn btn-accent" onClick={submit} disabled={busy}>
          {busy ? "Creating…" : "Create the goal"}
        </button>
        <span className="meta">Writes to Google Ads. Nothing in Tag Manager goes live until you publish.</span>
      </div>
    </div>
  );
}
