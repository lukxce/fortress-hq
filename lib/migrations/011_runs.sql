-- What an analysis run said at the top, and how much of the model's output was
-- thrown away. "12 inserted, 0 skipped" is the health check of the parser.
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS skipped_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS actions_dropped INTEGER NOT NULL DEFAULT 0;
