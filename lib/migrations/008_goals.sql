-- Conversion goals created through Fortress.
--
-- This table is an audit trail, not a source of truth: Google owns the real
-- objects. It exists so that a goal created here can be traced afterwards —
-- which Ads action, which GTM tag, and whether the container was ever
-- published, which is the step people forget.

CREATE TABLE IF NOT EXISTS conversion_goals (
  id                       SERIAL PRIMARY KEY,
  client_id                INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  category                 TEXT,
  counting_type            TEXT,
  is_primary               BOOLEAN NOT NULL DEFAULT FALSE,
  default_value            NUMERIC(12, 2),

  ads_customer_id          TEXT,
  ads_action_id            TEXT,
  ads_resource_name        TEXT,
  conversion_id            TEXT,   -- the AW-nnnnnnnnn half of send_to
  conversion_label         TEXT,   -- the label half

  trigger_kind             TEXT,   -- 'url' | 'event'
  trigger_match            TEXT,
  trigger_value            TEXT,

  gtm_container_id         TEXT,
  gtm_workspace_id         TEXT,
  gtm_trigger_id           TEXT,
  gtm_tag_id               TEXT,
  gtm_published            BOOLEAN NOT NULL DEFAULT FALSE,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversion_goals_client ON conversion_goals (client_id, created_at DESC);
