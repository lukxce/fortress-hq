-- Bidding health signals that Google already computes and hands over.
--
-- These are the cheapest diagnostics available anywhere in the product: they
-- are fields on queries the sync already runs, and they replace guesswork with
-- Google's own verdict on why a campaign is constrained.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS bid_strategy_status TEXT;
-- The target actually applied, which reflects ad-group overrides and portfolio
-- strategies. The campaign attribute alone does not.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS avg_target_cpa_micros BIGINT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS avg_target_roas NUMERIC(10,4);
-- Google's estimate of the budget at which lost impression share to budget
-- would be zero. A Google-computed constraint ratio, better than any threshold
-- we could invent.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS recommended_budget_micros BIGINT;

-- Whether a conversion action reports a real value or always substitutes one
-- fixed number. Target return-on-ad-spend on a constant is count bidding in
-- disguise, and this single field proves it.
ALTER TABLE conversion_actions ADD COLUMN IF NOT EXISTS always_use_default_value BOOLEAN;
ALTER TABLE conversion_actions ADD COLUMN IF NOT EXISTS default_value NUMERIC(14,2);

-- Conversion value before value rules and lifecycle adjustments. Compared with
-- the adjusted figure this is a one-query test for manufactured value.
ALTER TABLE metrics_daily ADD COLUMN IF NOT EXISTS original_conversion_value_micros BIGINT NOT NULL DEFAULT 0;
