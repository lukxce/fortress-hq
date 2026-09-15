-- Keeping the multi-user door open.
--
-- The app is single-operator today and the gate is a shared password. But
-- ownership is the expensive thing to retrofit: adding an owner column to a
-- table that already has rows means backfilling, deciding what the orphans
-- belong to, and touching every query at once. Adding it while the tables are
-- empty costs nothing.
--
-- Everything here is NULLABLE on purpose. Null means "belongs to the
-- installation" — which is exactly right for a single operator, and lets a
-- later migration backfill rather than restructure.

CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  email       TEXT UNIQUE,
  name        TEXT,
  -- Set when a real identity provider is wired up: the subject claim from
  -- whatever issues the identity. Null while the shared password is the gate.
  external_id TEXT UNIQUE,
  role        TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'member', 'viewer')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ
);

-- A Google connection is inherently personal: it is one human's consent, and
-- their refresh token. Whose it is matters the moment there is more than one.
ALTER TABLE connections ADD COLUMN IF NOT EXISTS user_id INTEGER
  REFERENCES users(id) ON DELETE CASCADE;

-- Who is responsible for a client, and later, who may see it.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS owner_id INTEGER
  REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS connections_user_idx ON connections (user_id);
CREATE INDEX IF NOT EXISTS clients_owner_idx ON clients (owner_id);

-- Explicit access grants. Unused while there is one user; the presence of the
-- table means per-client visibility is a feature to switch on rather than a
-- schema change to plan.
CREATE TABLE IF NOT EXISTS client_access (
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access     TEXT NOT NULL DEFAULT 'view' CHECK (access IN ('view', 'manage')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, user_id)
);
