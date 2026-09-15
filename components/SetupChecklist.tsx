import type { Check } from "@/lib/setup";

export function SetupChecklist({ checks }: { checks: Check[] }) {
  return (
    <div className="sheet sheet-pad" style={{ maxWidth: 720 }}>
      <ul className="checks">
        {checks.map((c) => (
          <li key={c.key} className={c.ok ? "ok" : "todo"}>
            <span className="mark" aria-hidden>{c.ok ? "✓" : ""}</span>
            <div className="body">
              <div className="head">
                <strong>{c.label}</strong>
                <span className={`pill ${c.ok ? "pill-good" : "pill-warn"}`}>
                  {c.ok ? "ready" : "needed"}
                </span>
              </div>
              {c.detail && <p className="meta detail">{c.detail}</p>}
              {!c.ok && c.fix && <p className="fix">{c.fix}</p>}
            </div>
          </li>
        ))}
      </ul>

      <p className="meta footnote">
        These come from <code>.env.local</code>. Copy <code>.env.example</code> and fill it in,
        then restart the dev server.
      </p>
    </div>
  );
}
