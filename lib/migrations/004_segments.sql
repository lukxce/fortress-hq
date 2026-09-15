-- The dimensions that make an account legible.
--
-- Campaign-level daily totals tell you that money left. They never tell you
-- where it went: which device, which hour, which network, which keyword. Each
-- of these is one GAQL query — one operation regardless of rows — so the whole
-- set costs under ten operations against a 15,000/day ceiling.

-- One table for every segmentation rather than one table per dimension. The
-- shape is identical in each case and the queries are the same shape too.
CREATE TABLE IF NOT EXISTS segment_metrics (
  client_id       INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  ads_customer_id TEXT NOT NULL,
  campaign_id     TEXT NOT NULL DEFAULT '',
  segment_type    TEXT NOT NULL,   -- device | hour | day_of_week | network | geo | match_type
  segment_key     TEXT NOT NULL,   -- MOBILE | 14 | MONDAY | SEARCH_PARTNERS | ...
  impressions     BIGINT NOT NULL DEFAULT 0,
  clicks          BIGINT NOT NULL DEFAULT 0,
  cost_micros     BIGINT NOT NULL DEFAULT 0,
  conversions     NUMERIC(14,2) NOT NULL DEFAULT 0,
  conversion_value_micros BIGINT NOT NULL DEFAULT 0,
  window_days     INTEGER NOT NULL DEFAULT 30,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ads_customer_id, campaign_id, segment_type, segment_key)
);

CREATE INDEX IF NOT EXISTS segment_metrics_lookup
  ON segment_metrics (client_id, segment_type, cost_micros DESC);

-- Keyword-level performance. The difference between a keyword that spends and
-- a keyword that works is the single most actionable thing in a search account,
-- and it is invisible at campaign level.
CREATE TABLE IF NOT EXISTS keywords (
  client_id       INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  ads_customer_id TEXT NOT NULL,
  campaign_id     TEXT NOT NULL,
  ad_group_id     TEXT NOT NULL,
  criterion_id    TEXT NOT NULL,
  text            TEXT NOT NULL DEFAULT '',
  match_type      TEXT,
  status          TEXT,
  quality_score   INTEGER,
  -- Google's own diagnosis of *why* a quality score is low, which is far more
  -- useful than the score itself.
  expected_ctr    TEXT,
  ad_relevance    TEXT,
  landing_page_experience TEXT,
  impressions     BIGINT NOT NULL DEFAULT 0,
  clicks          BIGINT NOT NULL DEFAULT 0,
  cost_micros     BIGINT NOT NULL DEFAULT 0,
  conversions     NUMERIC(14,2) NOT NULL DEFAULT 0,
  conversion_value_micros BIGINT NOT NULL DEFAULT 0,
  window_days     INTEGER NOT NULL DEFAULT 30,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ads_customer_id, criterion_id, ad_group_id)
);

CREATE INDEX IF NOT EXISTS keywords_client_spend ON keywords (client_id, cost_micros DESC);

-- Landing pages. Where the money actually lands, and whether that page works.
CREATE TABLE IF NOT EXISTS landing_pages (
  client_id       INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  ads_customer_id TEXT NOT NULL,
  url             TEXT NOT NULL,
  impressions     BIGINT NOT NULL DEFAULT 0,
  clicks          BIGINT NOT NULL DEFAULT 0,
  cost_micros     BIGINT NOT NULL DEFAULT 0,
  conversions     NUMERIC(14,2) NOT NULL DEFAULT 0,
  window_days     INTEGER NOT NULL DEFAULT 30,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ads_customer_id, url)
);

-- Tag Manager container contents, so "is it connected and does it work" has an
-- answer rather than a shrug.
CREATE TABLE IF NOT EXISTS gtm_tags (
  client_id     INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  container_id  TEXT NOT NULL,
  tag_id        TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  type          TEXT,
  paused        BOOLEAN NOT NULL DEFAULT FALSE,
  firing_triggers TEXT[],
  consent_status  TEXT,
  consent_types   TEXT[],
  notes         JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (container_id, tag_id)
);

CREATE TABLE IF NOT EXISTS gtm_snapshots (
  client_id      INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  container_id   TEXT NOT NULL,
  version_id     TEXT NOT NULL,
  version_name   TEXT,
  published_at   TIMESTAMPTZ,
  tag_count      INTEGER NOT NULL DEFAULT 0,
  fingerprint    TEXT,
  seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (container_id, version_id)
);
