import { q } from "@/lib/db";
import { requireAdmin, identityConfigured } from "@/lib/user";
import { Users } from "@/components/admin/Users";

export const dynamic = "force-dynamic";

export default async function AdminUsers() {
  const me = await requireAdmin();
  const [users, projects, shares] = await Promise.all([
    q<any>(`SELECT u.id, u.email, u.name, u.role, u.last_seen_at, count(c.id)::int AS owned
              FROM users u LEFT JOIN clients c ON c.owner_id = u.id AND NOT c.archived
             GROUP BY u.id ORDER BY u.id`),
    q<any>(`SELECT c.id, c.name, c.owner_id FROM clients c WHERE NOT c.archived ORDER BY c.name`),
    q<any>(`SELECT client_id, user_id, access FROM client_access`),
  ]);
  return (
    <div className="stack rise">
      <header className="page-head">
        <div>
          <div className="label eyebrow">Admin</div>
          <h1>People and access</h1>
          <p className="meta">Only admins see this.</p>
        </div>
      </header>
      {!identityConfigured && (
        <div className="notice notice-warn">
          <div>
            <strong>Separate sign-in is not switched on yet.</strong> Until the Clerk keys are set, everyone who knows the shared password acts as the first admin.
            Invitations, passwords, two-factor and removing someone happen in the Clerk dashboard; roles and sharing happen here.
          </div>
        </div>
      )}
      <Users users={users} projects={projects} shares={shares} me={me.id} />
    </div>
  );
}
