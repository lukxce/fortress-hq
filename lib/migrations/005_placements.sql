-- Placements, monthly trend, and conversion composition.
--
-- Three gaps that made deep analysis impossible:
--
-- 1. Placements. Display and PMax spend goes somewhere specific — a mobile game,
--    a made-for-advertising domain, a real publisher — and without that the only
--    available verdict is "display did badly", which is not a finding.
--
-- 2. Monthly shape. Comparing 30 days to the previous 30 says something changed.
--    It never says *when* it changed, which is the question that leads to a cause.
--
-- 3. Conversion composition. An account can report thousands of conversions that
--    are 99% one worthless action. The total looks healthy; the account is being
--    optimised toward nothing.

CREATE TABLE IF NOT EXISTS placements (
  client_id       INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  ads_customer_id TEXT NOT NULL,
  campaign_id     TEXT NOT NULL DEFAULT '',
  placement       TEXT NOT NULL,          -- domain, app id, or channel
  display_name    TEXT,
  placement_type  TEXT,                   -- WEBSITE | MOBILE_APPLICATION | YOUTUBE_*
  target_url      TEXT,
  impressions     BIGINT NOT NULL DEFAULT 0,
  clicks          BIGINT NOT NULL DEFAULT 0,
  cost_micros     BIGINT NOT NULL DEFAULT 0,
  conversions     NUMERIC(14,2) NOT NULL DEFAULT 0,
  window_days     INTEGER NOT NULL DEFAULT 90,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ads_customer_id, campaign_id, placement)
);

CREATE INDEX IF NOT EXISTS placements_client_clicks ON placements (client_id, clicks DESC);

-- Per-campaign monthly totals. Cheap to derive from metrics_daily, but
-- materialised because every trend question asks for it.
CREATE TABLE IF NOT EXISTS monthly_metrics (
  client_id   INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  month       DATE NOT NULL,              -- first day of month
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks      BIGINT NOT NULL DEFAULT 0,
  cost_micros BIGINT NOT NULL DEFAULT 0,
  conversions NUMERIC(14,2) NOT NULL DEFAULT 0,
  conversion_value_micros BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, campaign_id, month)
);

-- Per-conversion-action volume over time, so composition is visible rather than
-- collapsed into a single "conversions" number.
CREATE TABLE IF NOT EXISTS conversion_breakdown (
  client_id       INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  ads_customer_id TEXT NOT NULL,
  action_id       TEXT NOT NULL,
  action_name     TEXT NOT NULL DEFAULT '',
  month           DATE NOT NULL,
  conversions     NUMERIC(14,2) NOT NULL DEFAULT 0,
  conversion_value_micros BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (ads_customer_id, action_id, month)
);
