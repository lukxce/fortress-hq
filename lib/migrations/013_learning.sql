-- The brain learns from everything every project holds, not only from what
-- people click: every change made in each Google Ads account and what followed
-- it, patterns that repeat across accounts, and benchmarks from the portfolio
-- itself. What is measured applies automatically; what is interpreted from it
-- (a drafted lesson) waits for an admin unless they let it apply itself.

-- What kind of business a project is, so patterns can be read within a trade.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS industry TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS industry_source TEXT
  CHECK (industry_source IN ('auto', 'manual'));

-- Every change made in a Google Ads account, by anyone, through anything:
-- the interface, the API, scripts, Google's own automation. Google keeps 30
-- days of this, so it is copied daily and accumulates here.
CREATE TABLE IF NOT EXISTS change_events (
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  resource_name  TEXT NOT NULL,
  changed_at     TIMESTAMPTZ NOT NULL,
  resource_type  TEXT NOT NULL,
  operation      TEXT,
  campaign_id    TEXT,
  changed_fields TEXT,
  old_resource   JSONB,
  new_resource   JSONB,
  client_type    TEXT,
  PRIMARY KEY (client_id, resource_name, changed_at)
);
CREATE INDEX IF NOT EXISTS change_events_client ON change_events (client_id, changed_at);

-- A change, grouped (one campaign, one day, one kind), and what followed it.
CREATE TABLE IF NOT EXISTS change_outcomes (
  id            SERIAL PRIMARY KEY,
  client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source        TEXT NOT NULL CHECK (source IN ('account_change', 'recommendation')),
  ref           TEXT NOT NULL,
  kind          TEXT NOT NULL,
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
  campaign_id   TEXT,
  changed_on    DATE NOT NULL,
  channel_type  TEXT,
  bid_strategy  TEXT,
  volume_band   TEXT,
  status        TEXT NOT NULL DEFAULT 'waiting'
                  CHECK (status IN ('waiting', 'judged')),
  verdict       TEXT CHECK (verdict IN ('better', 'worse', 'no_clear_change', 'moved_with_account', 'too_little_data', 'confounded')),
  result        JSONB,
  evaluate_after DATE NOT NULL,
  evaluated_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, source, ref)
);
CREATE INDEX IF NOT EXISTS change_outcomes_due ON change_outcomes (status, evaluate_after);

-- Patterns computed across every project. Replaced wholesale on each run.
CREATE TABLE IF NOT EXISTS portfolio_patterns (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  industry    TEXT NOT NULL DEFAULT 'all',
  key         TEXT NOT NULL,
  stats       JSONB NOT NULL DEFAULT '{}'::jsonb,
  projects    INTEGER NOT NULL DEFAULT 0,
  significant BOOLEAN NOT NULL DEFAULT FALSE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, industry, key)
);

-- Lessons can now come from the brain itself.
ALTER TABLE brain_lessons ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'proposed', 'rejected', 'off'));
ALTER TABLE brain_lessons ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'admin'
  CHECK (source IN ('admin', 'distilled'));
ALTER TABLE brain_lessons ADD COLUMN IF NOT EXISTS evidence JSONB;
ALTER TABLE brain_lessons ADD COLUMN IF NOT EXISTS challenges_knowledge TEXT;
UPDATE brain_lessons SET status = 'off' WHERE NOT active AND status = 'active';

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
