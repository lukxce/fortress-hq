-- Synced data and the things derived from it.
--
-- Money from Google is stored in micros (bigint) exactly as returned. Division
-- by 1e6 happens at the display layer only, so no rounding error accumulates.
-- Conversions are numeric, not integer: Google returns fractional conversions
-- under data-driven attribution.

-- ---------------------------------------------------------------- campaigns --

CREATE TABLE IF NOT EXISTS campaigns (
  id              SERIAL PRIMARY KEY,
  client_id       INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  ads_customer_id TEXT NOT NULL,
  campaign_id     TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  status          TEXT,
  channel_type    TEXT,
  bidding_strategy TEXT,
  target_cpa_micros BIGINT,
  target_roas     NUMERIC(8,4),
  budget_micros   BIGINT,
  budget_shared   BOOLEAN NOT NULL DEFAULT FALSE,
  -- Google's own health signal, and the cheapest one available.
  primary_status  TEXT,
  primary_status_reasons TEXT[],
  start_date      DATE,
  end_date        DATE,
  last_synced_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ads_customer_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS campaigns_client_idx ON campaigns (client_id);

-- ------------------------------------------------------------- daily metrics --

CREATE TABLE IF NOT EXISTS metrics_daily (
  entity_type TEXT NOT NULL CHECK (entity_type IN ('campaign', 'account')),
  entity_id   TEXT NOT NULL,
  client_id   INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  impressions BIGINT  NOT NULL DEFAULT 0,
  clicks      BIGINT  NOT NULL DEFAULT 0,
  cost_micros BIGINT  NOT NULL DEFAULT 0,
  conversions NUMERIC(14,2) NOT NULL DEFAULT 0,
  conversion_value_micros BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (entity_type, entity_id, date)
);

CREATE INDEX IF NOT EXISTS metrics_daily_client_date_idx ON metrics_daily (client_id, date);

-- -------------------------------------------------------------- search terms --

CREATE TABLE IF NOT EXISTS search_terms (
  client_id       INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  ads_customer_id TEXT NOT NULL,
  campaign_id     TEXT,
  term            TEXT NOT NULL,
  match_source    TEXT,          -- AI Max: keyword vs broad vs keywordless
  impressions     BIGINT NOT NULL DEFAULT 0,
  clicks          BIGINT NOT NULL DEFAULT 0,
  cost_micros     BIGINT NOT NULL DEFAULT 0,
  conversions     NUMERIC(14,2) NOT NULL DEFAULT 0,
  window_days     INTEGER NOT NULL DEFAULT 30,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ads_customer_id, campaign_id, term)
);

CREATE INDEX IF NOT EXISTS search_terms_client_idx ON search_terms (client_id);
CREATE INDEX IF NOT EXISTS search_terms_waste_idx
  ON search_terms (client_id, conversions, cost_micros);

-- -------------------------------------------------------- conversion actions --

CREATE TABLE IF NOT EXISTS conversion_actions (
  client_id       INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  ads_customer_id TEXT NOT NULL,
  action_id       TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  category        TEXT,
  type            TEXT,
  status          TEXT,
  counting_type   TEXT,          -- ONE_PER_CLICK vs MANY_PER_CLICK
  include_in_conversions BOOLEAN,
  click_window_days INTEGER,
  view_window_days  INTEGER,
  conversions_30d NUMERIC(14,2) NOT NULL DEFAULT 0,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ads_customer_id, action_id)
);

-- --------------------------------------------------------------- GA4 / GSC --

CREATE TABLE IF NOT EXISTS ga4_daily (
  client_id    INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  property_id  TEXT NOT NULL,
  date         DATE NOT NULL,
  channel      TEXT NOT NULL DEFAULT '(all)',
  sessions     BIGINT NOT NULL DEFAULT 0,
  engaged_sessions BIGINT NOT NULL DEFAULT 0,
  key_events   NUMERIC(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, date, channel)
);

CREATE INDEX IF NOT EXISTS ga4_daily_client_idx ON ga4_daily (client_id, date);

CREATE TABLE IF NOT EXISTS gsc_daily (
  client_id   INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  site_url    TEXT NOT NULL,
  date        DATE NOT NULL,
  query       TEXT NOT NULL DEFAULT '',
  clicks      BIGINT NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  position    NUMERIC(6,2),
  PRIMARY KEY (site_url, date, query)
);

CREATE INDEX IF NOT EXISTS gsc_daily_client_idx ON gsc_daily (client_id, date);

-- ------------------------------------------------------------------ findings --

-- Deterministic findings: computed by code, never by a model. Every one carries
-- the numbers it was derived from so any claim on screen can be traced back.
CREATE TABLE IF NOT EXISTS findings (
  id          SERIAL PRIMARY KEY,
  client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  title       TEXT NOT NULL,
  detail      TEXT NOT NULL,
  evidence    JSONB NOT NULL DEFAULT '{}'::jsonb,
  money_at_stake_micros BIGINT,
  entity_type TEXT,
  entity_id   TEXT,
  status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, kind, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS findings_client_status_idx ON findings (client_id, status, severity);

-- Model output. Kept separate from findings so a conclusion drawn by a model is
-- never confused with a number computed by code.
CREATE TABLE IF NOT EXISTS insights (
  id          SERIAL PRIMARY KEY,
  client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  headline    TEXT NOT NULL,
  summary     TEXT NOT NULL,
  category    TEXT NOT NULL,
  priority    INTEGER NOT NULL DEFAULT 3,
  rationale   TEXT,
  next_steps  JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence    JSONB NOT NULL DEFAULT '{}'::jsonb,
  model       TEXT,
  status      TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'accepted', 'dismissed', 'done')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS insights_client_idx ON insights (client_id, status, priority);

-- One row per client per analysis run, so the dashboard can say when it last
-- looked and what it cost.
CREATE TABLE IF NOT EXISTS analysis_runs (
  id          SERIAL PRIMARY KEY,
  client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  model       TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cost_usd    NUMERIC(10,4),
  findings_count INTEGER NOT NULL DEFAULT 0,
  insights_count INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
