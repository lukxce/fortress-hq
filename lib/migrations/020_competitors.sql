-- Competitors: named by the operator or suggested from the account, then read
-- from their own website, Keyword Planner and — where a SERP data key is set —
-- the ads they actually run on the project's searches.
CREATE TABLE IF NOT EXISTS competitors (
  id            SERIAL PRIMARY KEY,
  client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  domain        TEXT,
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'suggested')),
  status        TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'suggested', 'ignored')),
  why           TEXT,
  site          JSONB,
  keywords      JSONB,
  brand_volume  INTEGER,
  observed_ads  JSONB NOT NULL DEFAULT '[]'::jsonb,
  analysed_at   TIMESTAMPTZ,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, domain)
);
CREATE INDEX IF NOT EXISTS competitors_client ON competitors (client_id, status);

-- Paid ads seen on the project's own searches, from a SERP data provider.
CREATE TABLE IF NOT EXISTS serp_ads (
  client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  keyword     TEXT NOT NULL,
  location    TEXT NOT NULL,
  position    INTEGER,
  domain      TEXT,
  title       TEXT,
  description TEXT,
  url         TEXT,
  seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS serp_ads_client ON serp_ads (client_id, seen_at);
