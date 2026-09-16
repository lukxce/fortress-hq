-- Separate logins, an admin brain that learns across everyone, and a proper
-- read of Analytics, Search Console and Tag Manager in their own right.

-- ------------------------------------------------------------- inventory --

-- One row per Google account a connection can reach, not one row per account
-- globally. With a single global row, whoever ran discovery last took
-- ownership of a shared Ads account, and discovery revoked every other
-- person's rows for that product. Two people who can both reach a client's
-- account now each have their own row.
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_provider_provider_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_connection_provider_id
  ON inventory (connection_id, provider, provider_id);
CREATE INDEX IF NOT EXISTS inventory_connection ON inventory (connection_id, provider, status);

-- ----------------------------------------------------------------- brain --

-- Rules the admin teaches the brain. They apply to every analysis for every
-- project and every user, alongside the verified knowledge layer.
CREATE TABLE IF NOT EXISTS brain_lessons (
  id          SERIAL PRIMARY KEY,
  text        TEXT NOT NULL,
  product     TEXT NOT NULL DEFAULT 'all'
                CHECK (product IN ('all', 'ads', 'analytics', 'search_console', 'tag_manager')),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Which Google product a finding or recommendation is about. "cross" is for
-- the ones that only exist because two products were read together.
ALTER TABLE findings ADD COLUMN IF NOT EXISTS product TEXT;
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'ads';

-- ------------------------------------------------------------- analytics --

-- Events by name and day, so a key event that stops firing is visible the
-- week it stops, and each event's own trend can be read.
CREATE TABLE IF NOT EXISTS ga4_events (
  client_id    INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  property_id  TEXT NOT NULL,
  date         DATE NOT NULL,
  event_name   TEXT NOT NULL,
  event_count  BIGINT NOT NULL DEFAULT 0,
  key_events   NUMERIC(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, date, event_name)
);
CREATE INDEX IF NOT EXISTS ga4_events_client ON ga4_events (client_id, date);

-- Sessions by device, by source / medium, and by country, 90 days, no date.
CREATE TABLE IF NOT EXISTS ga4_dims (
  client_id        INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  property_id      TEXT NOT NULL,
  dim_type         TEXT NOT NULL,
  key              TEXT NOT NULL,
  sessions         BIGINT NOT NULL DEFAULT 0,
  engaged_sessions BIGINT NOT NULL DEFAULT 0,
  key_events       NUMERIC(14,2) NOT NULL DEFAULT 0,
  window_days      INTEGER NOT NULL DEFAULT 90,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, dim_type, key)
);
CREATE INDEX IF NOT EXISTS ga4_dims_client ON ga4_dims (client_id, dim_type);

-- -------------------------------------------------------- search console --

-- Site totals by day. Query-level rows leave out anonymised queries, so they
-- under-count the site; these do not.
CREATE TABLE IF NOT EXISTS gsc_totals (
  client_id   INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  site_url    TEXT NOT NULL,
  date        DATE NOT NULL,
  clicks      BIGINT NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  position    NUMERIC(6,2),
  PRIMARY KEY (site_url, date)
);

-- Pages, with the previous period alongside, so movement is one query.
CREATE TABLE IF NOT EXISTS gsc_pages (
  client_id        INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  site_url         TEXT NOT NULL,
  page             TEXT NOT NULL,
  clicks           BIGINT NOT NULL DEFAULT 0,
  impressions      BIGINT NOT NULL DEFAULT 0,
  position         NUMERIC(6,2),
  prev_clicks      BIGINT NOT NULL DEFAULT 0,
  prev_impressions BIGINT NOT NULL DEFAULT 0,
  prev_position    NUMERIC(6,2),
  window_days      INTEGER NOT NULL DEFAULT 28,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_url, page)
);

-- Query × page over 90 days: the only way to see two pages competing for the
-- same search.
CREATE TABLE IF NOT EXISTS gsc_query_pages (
  client_id   INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  site_url    TEXT NOT NULL,
  query       TEXT NOT NULL,
  page        TEXT NOT NULL,
  clicks      BIGINT NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  position    NUMERIC(6,2),
  synced_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_url, query, page)
);
CREATE INDEX IF NOT EXISTS gsc_query_pages_client ON gsc_query_pages (client_id);

-- ----------------------------------------------------------- tag manager --

-- What a tag points at (a measurement ID, a conversion ID) and what fires it,
-- so duplicates and orphaned tags can be found.
ALTER TABLE gtm_tags ADD COLUMN IF NOT EXISTS parameters JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE gtm_tags ADD COLUMN IF NOT EXISTS blocking_triggers TEXT[];

CREATE TABLE IF NOT EXISTS gtm_triggers (
  client_id     INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  container_id  TEXT NOT NULL,
  trigger_id    TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  type          TEXT,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (container_id, trigger_id)
);

-- When each container version was first seen live. seen_at is refreshed on
-- every sync; this is not, so "tracking dropped after version 14 went live"
-- has a date to point at.
ALTER TABLE gtm_snapshots ADD COLUMN IF NOT EXISTS first_seen TIMESTAMPTZ NOT NULL DEFAULT now();
