-- Three more sources: page speed for every project, Google Business Profile,
-- and Keyword Planner volumes through the Google Ads API.

-- Business Profile is a fifth product a project can bind.
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_provider_check;
ALTER TABLE inventory ADD CONSTRAINT inventory_provider_check CHECK (provider IN ('ads', 'ga4', 'gsc', 'gtm', 'gbp'));
ALTER TABLE client_properties DROP CONSTRAINT IF EXISTS client_properties_provider_check;
ALTER TABLE client_properties ADD CONSTRAINT client_properties_provider_check CHECK (provider IN ('ads', 'ga4', 'gsc', 'gtm', 'gbp'));
ALTER TABLE brain_lessons DROP CONSTRAINT IF EXISTS brain_lessons_product_check;
ALTER TABLE brain_lessons ADD CONSTRAINT brain_lessons_product_check
  CHECK (product IN ('all', 'ads', 'analytics', 'search_console', 'tag_manager', 'business_profile', 'website'));

-- ------------------------------------------------------------- page speed --

-- One row per page and device, replaced on each check. "lab" is Lighthouse
-- run by PageSpeed Insights now; "field" is what real Chrome users experienced
-- over the last 28 days (Chrome UX Report), present only with enough traffic.
CREATE TABLE IF NOT EXISTS page_speed (
  client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  strategy      TEXT NOT NULL CHECK (strategy IN ('mobile', 'desktop')),
  role          TEXT,
  score         INTEGER,
  lab           JSONB NOT NULL DEFAULT '{}'::jsonb,
  field         JSONB,
  field_scope   TEXT,
  opportunities JSONB NOT NULL DEFAULT '[]'::jsonb,
  error         TEXT,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, url, strategy)
);

-- ------------------------------------------------------ business profile --

CREATE TABLE IF NOT EXISTS gbp_daily (
  client_id   INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  date        DATE NOT NULL,
  metric      TEXT NOT NULL,
  value       BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (location_id, date, metric)
);
CREATE INDEX IF NOT EXISTS gbp_daily_client ON gbp_daily (client_id, date);

-- What people searched when the profile appeared. Google reports small counts
-- only as "fewer than N", kept as threshold.
CREATE TABLE IF NOT EXISTS gbp_keywords (
  client_id   INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  month       DATE NOT NULL,
  keyword     TEXT NOT NULL,
  impressions BIGINT,
  threshold   BIGINT,
  PRIMARY KEY (location_id, month, keyword)
);

CREATE TABLE IF NOT EXISTS gbp_reviews (
  client_id   INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  review_id   TEXT NOT NULL,
  rating      INTEGER,
  comment     TEXT,
  replied     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ,
  PRIMARY KEY (location_id, review_id)
);

-- --------------------------------------------------------- keyword planner --

-- Volumes for what the project already has: keywords, converting searches,
-- organic queries. Sources say where each one came from.
CREATE TABLE IF NOT EXISTS keyword_volumes (
  client_id         INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  keyword           TEXT NOT NULL,
  sources           TEXT[] NOT NULL DEFAULT '{}',
  avg_monthly       BIGINT,
  competition       TEXT,
  competition_index INTEGER,
  low_bid_micros    BIGINT,
  high_bid_micros   BIGINT,
  monthly           JSONB,
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, keyword)
);

-- New ideas Keyword Planner suggests from the project's converting searches and website.
CREATE TABLE IF NOT EXISTS keyword_ideas (
  client_id         INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  keyword           TEXT NOT NULL,
  avg_monthly       BIGINT,
  competition       TEXT,
  competition_index INTEGER,
  low_bid_micros    BIGINT,
  high_bid_micros   BIGINT,
  fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, keyword)
);

-- Where and in what language volumes were measured, so the page can say so.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS keyword_targeting JSONB;
