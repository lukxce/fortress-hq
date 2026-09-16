-- Fortress v3: the action loop.
--
-- Until now Fortress described accounts. v3 tells the operator what to change,
-- can make five kinds of change itself behind a confirmation, checks later
-- whether the change worked, builds campaigns, and builds conversion tracking.
-- Every table below exists for one of those jobs.

-- ------------------------------------------------------ account structure --

-- Ad groups and ads. Without these a recommendation cannot name where a keyword
-- lives or whether an ad group has any real ads in it.
CREATE TABLE IF NOT EXISTS ad_groups (
  client_id       INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  ads_customer_id TEXT NOT NULL,
  campaign_id     TEXT NOT NULL,
  ad_group_id     TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  status          TEXT,
  type            TEXT,
  cpc_bid_micros  BIGINT,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ads_customer_id, ad_group_id)
);
CREATE INDEX IF NOT EXISTS ad_groups_client ON ad_groups (client_id, campaign_id);

CREATE TABLE IF NOT EXISTS ads (
  client_id       INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  ads_customer_id TEXT NOT NULL,
  campaign_id     TEXT NOT NULL,
  ad_group_id     TEXT NOT NULL,
  ad_id           TEXT NOT NULL,
  type            TEXT,
  status          TEXT,
  ad_strength     TEXT,
  final_urls      TEXT[] NOT NULL DEFAULT '{}',
  headlines       JSONB NOT NULL DEFAULT '[]'::jsonb,
  descriptions    JSONB NOT NULL DEFAULT '[]'::jsonb,
  path1           TEXT,
  path2           TEXT,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ads_customer_id, ad_group_id, ad_id)
);
CREATE INDEX IF NOT EXISTS ads_client ON ads (client_id, ad_group_id);

-- Ad-group daily metrics sit in the same table as campaigns.
ALTER TABLE metrics_daily DROP CONSTRAINT IF EXISTS metrics_daily_entity_type_check;
ALTER TABLE metrics_daily ADD CONSTRAINT metrics_daily_entity_type_check
  CHECK (entity_type IN ('campaign', 'account', 'ad_group'));

-- Hour × day of week × campaign, without dates. "Stop bidding after 22:00 on
-- weekdays" needs the shape of a typical week, not a row per hour per day.
CREATE TABLE IF NOT EXISTS schedule_metrics (
  client_id       INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  ads_customer_id TEXT NOT NULL,
  campaign_id     TEXT NOT NULL,
  day_of_week     TEXT NOT NULL,
  hour            INTEGER NOT NULL,
  impressions     BIGINT NOT NULL DEFAULT 0,
  clicks          BIGINT NOT NULL DEFAULT 0,
  cost_micros     BIGINT NOT NULL DEFAULT 0,
  conversions     NUMERIC(14,2) NOT NULL DEFAULT 0,
  conversion_value_micros BIGINT NOT NULL DEFAULT 0,
  window_days     INTEGER NOT NULL DEFAULT 90,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ads_customer_id, campaign_id, day_of_week, hour)
);
CREATE INDEX IF NOT EXISTS schedule_metrics_client ON schedule_metrics (client_id);

-- Impression share, and — separately — how much was lost to budget and how
-- much to rank. They need opposite fixes, so they are never blended.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS search_impression_share NUMERIC(8,4);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS search_lost_is_budget NUMERIC(8,4);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS search_lost_is_rank NUMERIC(8,4);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS budget_resource_name TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS geo_target_type TEXT;

-- Negatives that already exist, at every level. Without them the tool can
-- suggest a negative the account already has.
CREATE TABLE IF NOT EXISTS negatives (
  client_id       INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  ads_customer_id TEXT NOT NULL,
  level           TEXT NOT NULL CHECK (level IN ('campaign', 'ad_group', 'shared')),
  campaign_id     TEXT NOT NULL DEFAULT '',
  ad_group_id     TEXT NOT NULL DEFAULT '',
  shared_set_id   TEXT NOT NULL DEFAULT '',
  text            TEXT NOT NULL,
  match_type      TEXT NOT NULL DEFAULT '',
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ads_customer_id, level, campaign_id, ad_group_id, shared_set_id, text, match_type)
);
CREATE INDEX IF NOT EXISTS negatives_client ON negatives (client_id);

-- When a conversion action last actually received a hit. A primary action that
-- has gone quiet is a broken tag, and this is the only field that proves it.
ALTER TABLE conversion_actions ADD COLUMN IF NOT EXISTS last_received_at TIMESTAMPTZ;
ALTER TABLE conversion_actions ADD COLUMN IF NOT EXISTS origin TEXT;
ALTER TABLE conversion_actions ADD COLUMN IF NOT EXISTS created_at_google TIMESTAMPTZ;

-- Account-level conversion settings that decide whether imports and enhanced
-- conversions can work at all.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ads_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Words from the business's own name. Search terms containing them are never
-- treated as waste and never proposed as negatives.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS brand_terms TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS website TEXT;

-- Analytics by landing page and channel, so paid traffic's engagement on a page
-- can be read next to what that page costs in Ads.
CREATE TABLE IF NOT EXISTS ga4_pages (
  client_id        INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  property_id      TEXT NOT NULL,
  page             TEXT NOT NULL,
  channel          TEXT NOT NULL,
  sessions         BIGINT NOT NULL DEFAULT 0,
  engaged_sessions BIGINT NOT NULL DEFAULT 0,
  key_events       NUMERIC(14,2) NOT NULL DEFAULT 0,
  window_days      INTEGER NOT NULL DEFAULT 90,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, page, channel)
);
CREATE INDEX IF NOT EXISTS ga4_pages_client ON ga4_pages (client_id);

-- ------------------------------------------------------- recommendations --

-- What to change. Written by the model around findings computed by code: every
-- figure on a recommendation is copied from findings, never produced by the
-- model. monthly_impact is summed by code from the findings it cites.
CREATE TABLE IF NOT EXISTS recommendations (
  id              SERIAL PRIMARY KEY,
  client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  run_id          INTEGER,
  area            TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('do_first', 'worth_doing', 'when_time')),
  title           TEXT NOT NULL,
  why             TEXT NOT NULL DEFAULT '',
  steps           JSONB NOT NULL DEFAULT '[]'::jsonb,
  do_by           DATE,
  effort_minutes  INTEGER,
  monthly_impact  NUMERIC(14,2),
  finding_kinds   TEXT[] NOT NULL DEFAULT '{}',
  evidence        JSONB NOT NULL DEFAULT '{}'::jsonb,
  action          JSONB,
  prediction      JSONB,
  campaign_plan   JSONB,
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'done', 'dismissed', 'superseded')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recommendations_client ON recommendations (client_id, status, severity);

-- Experiments. A proposal has no clock: applied_at stays null, and nothing is
-- measured, until the operator starts it.
CREATE TABLE IF NOT EXISTS experiments (
  id                SERIAL PRIMARY KEY,
  client_id         INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  recommendation_id INTEGER REFERENCES recommendations(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  hypothesis        TEXT NOT NULL DEFAULT '',
  metric            TEXT NOT NULL DEFAULT 'cpa' CHECK (metric IN ('cpa', 'spend', 'conversions', 'cvr')),
  direction         TEXT NOT NULL DEFAULT 'down' CHECK (direction IN ('up', 'down')),
  scope             JSONB NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL DEFAULT 'proposed'
                      CHECK (status IN ('proposed', 'running', 'finished', 'abandoned')),
  applied_at        TIMESTAMPTZ,
  applied_via       TEXT CHECK (applied_via IN ('button', 'manual')),
  baseline          JSONB,
  due_at            TIMESTAMPTZ,
  verdict           TEXT CHECK (verdict IN ('confirmed', 'refuted', 'inconclusive')),
  result            JSONB,
  evaluated_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS experiments_client ON experiments (client_id, status);

-- Every change Fortress makes in Google Ads, who confirmed it, and what Google
-- said back.
CREATE TABLE IF NOT EXISTS action_log (
  id                SERIAL PRIMARY KEY,
  client_id         INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recommendation_id INTEGER REFERENCES recommendations(id) ON DELETE SET NULL,
  experiment_id     INTEGER REFERENCES experiments(id) ON DELETE SET NULL,
  kind              TEXT NOT NULL,
  params            JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary           TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL CHECK (status IN ('applied', 'failed')),
  error             TEXT,
  result            JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS action_log_client ON action_log (client_id, created_at DESC);

-- --------------------------------------------------------------- builder --

CREATE TABLE IF NOT EXISTS drafts (
  id          SERIAL PRIMARY KEY,
  client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'New campaign',
  source      TEXT NOT NULL DEFAULT 'wizard' CHECK (source IN ('wizard', 'brain')),
  step        INTEGER NOT NULL DEFAULT 1,
  state       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'launching', 'launched', 'failed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drafts_client ON drafts (client_id, updated_at DESC);

-- The launch log. Each step is written before the next begins, so a failure
-- halfway leaves a paused campaign and a re-run resumes rather than duplicates.
CREATE TABLE IF NOT EXISTS launch_steps (
  id            SERIAL PRIMARY KEY,
  draft_id      INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  step          TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('done', 'failed')),
  resource_name TEXT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (draft_id, step)
);

CREATE TABLE IF NOT EXISTS site_summaries (
  client_id   INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  summary     JSONB NOT NULL DEFAULT '{}'::jsonb,
  crawled_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
