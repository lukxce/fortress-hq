-- Every time an admin views the app as someone else. Read-only, but still a
-- record of who looked at whose accounts and when.
CREATE TABLE IF NOT EXISTS view_as_log (
  id         SERIAL PRIMARY KEY,
  admin_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
