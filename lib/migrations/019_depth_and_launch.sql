-- Depth on the four things an operator touches most — ads, bids, search terms,
-- negatives — and the guided launch with its follow-ups and undo.

-- ---------------------------------------------------------------- ad copy --
ALTER TABLE ads ADD COLUMN IF NOT EXISTS impressions BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS clicks BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS cost_micros BIGINT NOT NULL DEFAULT 0;
ALTER TABLE ads ADD COLUMN IF NOT EXISTS conversions NUMERIC(14,2) NOT NULL DEFAULT 0;

-- Each headline and description of each responsive search ad, with Google's
-- own rating of it and how often it was shown.
CREATE TABLE IF NOT EXISTS ad_assets (
  client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id   TEXT NOT NULL,
  ad_group_id   TEXT NOT NULL,
  ad_id         TEXT NOT NULL,
  field_type    TEXT NOT NULL,
  text          TEXT NOT NULL,
  performance_label TEXT,
  pinned_field  TEXT,
  enabled       BOOLEAN,
  impressions   BIGINT NOT NULL DEFAULT 0,
  clicks        BIGINT NOT NULL DEFAULT 0,
  conversions   NUMERIC(14,2) NOT NULL DEFAULT 0,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, ad_id, field_type, text)
);

-- ------------------------------------------------------------------- bids --
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS cpc_bid_micros BIGINT;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS effective_cpc_bid_micros BIGINT;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS first_page_cpc_micros BIGINT;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS top_of_page_cpc_micros BIGINT;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS first_position_cpc_micros BIGINT;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS search_is NUMERIC(8,4);
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS search_top_is NUMERIC(8,4);
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS search_abs_top_is NUMERIC(8,4);
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS search_rank_lost_is NUMERIC(8,4);

-- ----------------------------------------------------------- search terms --
-- Which keyword, with which match type, brought each search in (Search
-- campaigns only: Performance Max has no keywords).
CREATE TABLE IF NOT EXISTS search_term_keywords (
  client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id   TEXT NOT NULL,
  ad_group_id   TEXT NOT NULL,
  term          TEXT NOT NULL,
  keyword_text  TEXT NOT NULL,
  keyword_match TEXT NOT NULL,
  impressions   BIGINT NOT NULL DEFAULT 0,
  clicks        BIGINT NOT NULL DEFAULT 0,
  cost_micros   BIGINT NOT NULL DEFAULT 0,
  conversions   NUMERIC(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, campaign_id, ad_group_id, term, keyword_text, keyword_match)
);
-- The last 28 days beside the 90, so a search that has just started wasting shows.
ALTER TABLE search_terms ADD COLUMN IF NOT EXISTS recent_clicks BIGINT NOT NULL DEFAULT 0;
ALTER TABLE search_terms ADD COLUMN IF NOT EXISTS recent_cost_micros BIGINT NOT NULL DEFAULT 0;
ALTER TABLE search_terms ADD COLUMN IF NOT EXISTS recent_conversions NUMERIC(14,2) NOT NULL DEFAULT 0;

-- A decision about a line that should not be asked again ("keep this search").
CREATE TABLE IF NOT EXISTS line_decisions (
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('search_term', 'keyword')),
  text       TEXT NOT NULL,
  decision   TEXT NOT NULL CHECK (decision IN ('keep', 'ignore')),
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, kind, text)
);

-- ----------------------------------------------------------------- launch --
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS guided JSONB;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS proposal JSONB;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS campaign_resource TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS live_at TIMESTAMPTZ;
ALTER TABLE drafts DROP CONSTRAINT IF EXISTS drafts_status_check;
-- "paused": built in Google Ads, waiting for the separate go-live decision.
ALTER TABLE drafts ADD CONSTRAINT drafts_status_check
  CHECK (status IN ('draft', 'launching', 'paused', 'launched', 'failed'));

-- Things to look at again, with a date: "is the new campaign showing", "review
-- search terms after two weeks", "keep or stop after a month".
CREATE TABLE IF NOT EXISTS follow_ups (
  id         SERIAL PRIMARY KEY,
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  draft_id   INTEGER REFERENCES drafts(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  href       TEXT,
  due_on     DATE NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS follow_ups_due ON follow_ups (client_id, status, due_on);

-- ------------------------------------------------------------------- undo --
ALTER TABLE action_log ADD COLUMN IF NOT EXISTS undo JSONB;
ALTER TABLE action_log ADD COLUMN IF NOT EXISTS undone_at TIMESTAMPTZ;
