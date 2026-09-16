-- AI Max migration state.
--
-- Campaign-level broad match and automatically created assets are being
-- converted through September 2026. The two source cohorts land with different
-- defaults, so an account will contain both and cannot be audited uniformly.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ai_max_enabled BOOLEAN;
-- One-way ratchet. Once true, disabling AI Max also disables brand inclusions
-- and exclusions — so the intuitive remediation silently removes the guardrails.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ai_max_bundling_required BOOLEAN;
-- Which cohort a campaign arrived from. The automatically-created-assets cohort
-- gets text customisation switched on as well; the broad-match cohort does not.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS aca_migrated_at TIMESTAMPTZ;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS broad_match_migrated_at TIMESTAMPTZ;
