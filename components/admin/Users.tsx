"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type User = { id: number; email: string | null; name: string | null; role: string; last_seen_at: string | null; owned: number };
type Project = { id: number; name: string; owner_id: number | null; owner: string | null };
type Share = { client_id: number; user_id: number; access: string };

const ROLE = { owner: "Admin", member: "Member", viewer: "Viewer" } as Record<string, string>;

export function Users({ users, projects, shares, me }: { users: User[]; projects: Project[]; shares: Share[]; me: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<{ user: string; project: string; access: string }>({ user: "", project: "", access: "view" });

  async function act(payload: object) {
    setBusy(true); setError(null);
    const res = await fetch("/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const b = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(b.error ?? "Could not save.");
    router.refresh();
  }
  const who = (id: number | null) => users.find((u) => u.id === id)?.email ?? "—";

  return (
    <div className="stack">
      {error && <p className="err">{error}</p>}
      <div className="card">
        <div className="card-head"><h2>People</h2><span className="meta">Each person signs in separately and connects their own Google account.</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Person</th><th>Role</th><th className="r">Own projects</th><th>Shared with them</th><th>Last seen</th><th></th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td><div className="cell-name">{u.name ?? u.email ?? `User ${u.id}`}</div><div className="cell-sub">{u.email}</div></td>
                  <td>
                    <select value={u.role} disabled={busy || u.id === me} style={{ width: "auto" }} aria-label="Role"
                      onChange={(e) => act({ action: "role", userId: u.id, role: e.target.value })}>
                      {Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td className="num r">{u.owned}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      {shares.filter((s) => s.user_id === u.id).map((s) => (
                        <span key={s.client_id} className="pill">
                          {projects.find((p) => p.id === s.client_id)?.name} · {s.access}
                          <button aria-label="Stop sharing" disabled={busy} onClick={() => act({ action: "unshare", userId: u.id, clientId: s.client_id })}
                            style={{ border: 0, background: "none", cursor: "pointer", padding: "0 0 0 4px", color: "inherit" }}>×</button>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="meta">{u.last_seen_at ? new Date(u.last_seen_at).toLocaleDateString("en-GB") : "never"}</td>
                  <td>{u.id !== me && (
                    <button className="btn btn-sm" disabled={busy} onClick={async () => {
                      setBusy(true);
                      const res = await fetch("/api/admin/view-as", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: u.id }) });
                      if (res.ok) { window.location.href = "/overview"; return; }
                      setBusy(false); setError("Could not switch.");
                    }}>View as</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-pad">
        <h2 style={{ marginBottom: 6 }}>Share a project</h2>
        <p className="meta" style={{ marginBottom: 12 }}>
          View lets them read everything. Manage also lets them analyse, apply changes and edit settings. Syncing still uses the owner&rsquo;s Google connection.
        </p>
        <div className="row">
          <select value={pick.project} onChange={(e) => setPick({ ...pick, project: e.target.value })} style={{ width: "auto" }} aria-label="Project">
            <option value="">Project…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({who(p.owner_id)})</option>)}
          </select>
          <select value={pick.user} onChange={(e) => setPick({ ...pick, user: e.target.value })} style={{ width: "auto" }} aria-label="Person">
            <option value="">Person…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.email ?? u.name}</option>)}
          </select>
          <select value={pick.access} onChange={(e) => setPick({ ...pick, access: e.target.value })} style={{ width: "auto" }} aria-label="Access">
            <option value="view">View</option><option value="manage">Manage</option>
          </select>
          <button className="btn btn-primary" disabled={busy || !pick.user || !pick.project}
            onClick={() => act({ action: "share", userId: Number(pick.user), clientId: Number(pick.project), access: pick.access })}>Share</button>
          <button className="btn" disabled={busy || !pick.user || !pick.project}
            onClick={() => confirm("Make this person the project's owner?") && act({ action: "transfer", userId: Number(pick.user), clientId: Number(pick.project) })}>Transfer ownership</button>
        </div>
      </div>
    </div>
  );
}
