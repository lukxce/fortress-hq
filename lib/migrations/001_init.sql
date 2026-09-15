-- Fortress HQ — initial schema.
-- Money from Google is stored in micros (bigint) exactly as returned; division
-- by 1e6 happens at the display layer only. Dates are in the account's own
-- timezone, which is recorded per inventory row.

CREATE TABLE IF NOT EXISTS connections (
  id                SERIAL PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN ('user_oauth', 'service_account')),
  google_email      TEXT,
  refresh_token_enc TEXT,                       -- AES-256-GCM, null for service accounts
  scopes            TEXT[] NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'invalid', 'revoked')),
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at      TIMESTAMPTZ
);

-- Everything discovery found, across all four products. This is the pick list.
CREATE TABLE IF NOT EXISTS inventory (
  id            SERIAL PRIMARY KEY,
  connection_id INTEGER REFERENCES connections(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('ads', 'ga4', 'gsc', 'gtm')),
  provider_id   TEXT NOT NULL,
  display_name  TEXT NOT NULL DEFAULT '',
  domain        TEXT,                            -- derived where the product exposes one
  parent_id     TEXT,                            -- MCC for ads, account for ga4/gtm
  parent_name   TEXT,
  is_manager    BOOLEAN NOT NULL DEFAULT FALSE,  -- ads only: managers are folders, not spendable
  currency      TEXT,
  timezone      TEXT,
  extra         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'available'
                  CHECK (status IN ('available', 'selected', 'revoked')),
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_id)
);

CREATE INDEX IF NOT EXISTS inventory_provider_status_idx ON inventory (provider, status);
CREATE INDEX IF NOT EXISTS inventory_domain_idx ON inventory (domain) WHERE domain IS NOT NULL;

-- A client is a binding plus the judgement calls that no API can tell us.
CREATE TABLE IF NOT EXISTS clients (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  goal_type      TEXT CHECK (goal_type IN ('cpa', 'roas')),
  target_cpa     NUMERIC(12, 2),
  target_roas    NUMERIC(8, 2),
  monthly_budget NUMERIC(12, 2),
  currency       TEXT,
  timezone       TEXT,
  notes          TEXT,
  archived       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Which inventory row fills each of a client's four slots, and how sure we are.
CREATE TABLE IF NOT EXISTS client_properties (
  client_id    INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL CHECK (provider IN ('ads', 'ga4', 'gsc', 'gtm')),
  inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  bound_by     TEXT NOT NULL DEFAULT 'manual'
                 CHECK (bound_by IN ('auto', 'confirmed', 'manual')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, provider)
);

CREATE INDEX IF NOT EXISTS client_properties_inventory_idx ON client_properties (inventory_id);

-- Per-day, per-API call accounting. Google exposes no "quota remaining"
-- endpoint, so we count our own. Failed Ads calls still consume quota.
CREATE TABLE IF NOT EXISTS quota_usage (
  day      DATE NOT NULL,
  provider TEXT NOT NULL,
  ops      INTEGER NOT NULL DEFAULT 0,
  errors   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, provider)
);

-- Every job run, keyed so a re-run is a no-op rather than a double sync.
CREATE TABLE IF NOT EXISTS job_runs (
  id          SERIAL PRIMARY KEY,
  job         TEXT NOT NULL,
  client_id   INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  day         DATE NOT NULL DEFAULT CURRENT_DATE,
  status      TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running', 'ok', 'failed')),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ops_used    INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (job, client_id, day)
);
