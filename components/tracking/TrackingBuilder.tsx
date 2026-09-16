"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const WINS = [
  { value: "SUBMIT_LEAD_FORM", label: "Someone fills in a contact form", name: "Contact form", counting: "one" },
  { value: "PHONE_CALL_LEAD", label: "Someone taps the phone number", name: "Phone number tap", counting: "one" },
  { value: "REQUEST_QUOTE", label: "Someone asks for a quote", name: "Quote request", counting: "one" },
  { value: "BOOK_APPOINTMENT", label: "Someone books an appointment", name: "Appointment booked", counting: "one" },
  { value: "PURCHASE", label: "Someone buys something", name: "Purchase", counting: "every" },
  { value: "SIGNUP", label: "Someone signs up", name: "Sign-up", counting: "one" },
] as const;

type Result = {
  goalId: number; conversionId: string | null; conversionLabel: string | null; eventSnippet: string | null;
  gtm: { workspaceId: string; linkerCreated: boolean; ga4TagId: string | null } | null; warnings: string[];
};

/**
 * Four questions, then it creates the conversion action in Google Ads and the
 * tags in Tag Manager (or hands back an import file). The counting rule is
 * locked to the answer to the first question, and says why.
 */
export function TrackingBuilder({ clientId, canWriteGtm, primaryCount }: { clientId: number; canWriteGtm: boolean; primaryCount: number }) {
  const router = useRouter();
  const [win, setWin] = useState<(typeof WINS)[number] | null>(null);
  const [name, setName] = useState("");
  const [how, setHow] = useState<"url" | "event">("url");
  const [match, setMatch] = useState<"contains" | "equals" | "startsWith">("contains");
  const [value, setValue] = useState("");
  const [amount, setAmount] = useState("");
  const [primary, setPrimary] = useState<boolean | null>(null);
  const [writeGtm, setWriteGtm] = useState(canWriteGtm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const phone = win?.value === "PHONE_CALL_LEAD";
  const ready = win && name.trim() && (phone || value.trim()) && primary !== null;

  async function create() {
    if (!ready || !win) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/goals?client=${clientId}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), category: win.value, isPrimary: primary,
          defaultValue: amount.trim() === "" ? null : Number(amount),
          createGtmTag: writeGtm,
          trigger: phone ? { kind: "phone" } : how === "url" ? { kind: "url", match, value: value.trim() } : { kind: "event", value: value.trim() },
        }),
      });
      const b = await res.json();
      if (!res.ok) throw new Error(b.message ?? b.error ?? "Could not create the goal.");
      setResult(b);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="card-pad stack-sm">
        <span className="pill pill-good">Created in Google Ads</span>
        <h3>{name}</h3>
        {result.gtm ? (
          <div className="notice notice-blue">
            <div>
              The trigger and the Google Ads conversion tag{result.gtm.ga4TagId ? ", the matching Analytics event" : ""}
              {result.gtm.linkerCreated ? " and a conversion linker" : ""} are in Tag Manager&rsquo;s default workspace.{" "}
              <strong>Nothing is live until you publish it in Tag Manager</strong> — until then this goal records nothing.
            </div>
          </div>
        ) : (
          <p>No tags were written. Import the file below into Tag Manager (Admin → Import container → Merge), review the tags, and publish.</p>
        )}
        {result.conversionLabel && (
          <p><a className="btn" href={`/api/goals/file?client=${clientId}&goal=${result.goalId}`}>Download the Tag Manager import file</a></p>
        )}
        {result.warnings.map((w) => <p key={w} className="meta">{w}</p>)}
        <div><button className="btn btn-quiet" onClick={() => { setResult(null); setWin(null); setName(""); setValue(""); setPrimary(null); }}>Create another</button></div>
      </div>
    );
  }

  return (
    <div className="card-pad stack">
      <div className="stack-sm">
        <div className="label">1 · What counts as a win?</div>
        <div className="grid-2" style={{ gap: 8 }}>
          {WINS.map((w) => (
            <button key={w.value} type="button" className={`choice${win?.value === w.value ? " selected" : ""}`}
              onClick={() => { setWin(w); if (!name || WINS.some((x) => x.name === name)) setName(w.name); }}>
              <span>{w.label}</span>
            </button>
          ))}
        </div>
        {win && (
          <p className="field-note">
            {win.counting === "one"
              ? <><strong>Counted once per click.</strong> The same person filling the form twice is still one lead — counting both would make your ads look better than they are.</>
              : <><strong>Counted every time.</strong> A second purchase really is a second sale.</>}
            {phone && " A phone tap counts the tap, not the call: Google cannot record calls from ads in Serbia."}
          </p>
        )}
      </div>

      {win && (
        <div className="stack-sm">
          <div className="label">2 · How do we know it happened?</div>
          {phone ? (
            <p className="meta">Any tap on a <span className="mono">tel:</span> link on the site. Nothing to configure.</p>
          ) : (
            <>
              <div className="tabs">
                <button type="button" className={`tab${how === "url" ? " active" : ""}`} onClick={() => setHow("url")}>They reach a thank-you page</button>
                <button type="button" className={`tab${how === "event" ? " active" : ""}`} onClick={() => setHow("event")}>The site sends an event</button>
              </div>
              <div className="field-row">
                {how === "url" && (
                  <div className="field" style={{ maxWidth: 200 }}>
                    <label className="label" htmlFor="t-match">The address</label>
                    <select id="t-match" value={match} onChange={(e) => setMatch(e.target.value as typeof match)}>
                      <option value="contains">contains</option>
                      <option value="startsWith">starts with</option>
                      <option value="equals">is exactly</option>
                    </select>
                  </div>
                )}
                <div className="field">
                  <label className="label" htmlFor="t-val">{how === "url" ? "this text" : "event name"}</label>
                  <input id="t-val" type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder={how === "url" ? "/hvala" : "generate_lead"} />
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {win && (
        <div className="field-row">
          <div className="field">
            <label className="label" htmlFor="t-name">3 · Name it</label>
            <input id="t-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="t-amount">Is it worth a fixed amount? (optional)</label>
            <input id="t-amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="leave empty if not" />
          </div>
        </div>
      )}

      {win && (
        <div className="stack-sm">
          <div className="label">4 · Should bidding optimise toward it?</div>
          <div className="grid-2" style={{ gap: 8 }}>
            <button type="button" className={`choice${primary === true ? " selected" : ""}`} onClick={() => setPrimary(true)}>
              <span><strong>Yes — primary</strong><span className="meta">It goes in the Conversions column and Smart Bidding chases it.</span></span>
            </button>
            <button type="button" className={`choice${primary === false ? " selected" : ""}`} onClick={() => setPrimary(false)}>
              <span><strong>Not yet — secondary</strong><span className="meta">It records and reports but does not steer bidding. Safer until it has counted correctly for a couple of weeks.</span></span>
            </button>
          </div>
          {primary && primaryCount > 0 && (
            <p className="field-note">This account already has {primaryCount} primary action{primaryCount === 1 ? "" : "s"}. If this one measures the same lead, one of them should become secondary, or every lead is counted twice.</p>
          )}
        </div>
      )}

      {win && (
        <div className="spread" style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
          {canWriteGtm ? (
            <label className="row" style={{ cursor: "pointer" }}>
              <input type="checkbox" className="check" checked={writeGtm} onChange={(e) => setWriteGtm(e.target.checked)} />
              <span>Write the tags into Tag Manager for me to publish</span>
            </label>
          ) : <span className="meta">Tag Manager isn&rsquo;t connected — you will get an import file.</span>}
          <div className="row">
            {error && <span className="err">{error}</span>}
            <button className="btn btn-primary" onClick={create} disabled={!ready || busy}>
              {busy && <span className="spinner" />}Create in Google Ads
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
