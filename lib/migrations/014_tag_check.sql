-- The Google IDs a project should have on its website (Google Ads conversion
-- ID, Analytics measurement ID, Tag Manager container), and what a check of
-- the live site and the live container found.
CREATE TABLE IF NOT EXISTS tag_checks (
  client_id  INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  result     JSONB NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
