-- Keep what was sent to the model and what came back, for every analysis, so a
-- paid run can always be read in full — including one that failed.
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS request JSONB;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS response_text TEXT;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS stop_reason TEXT;
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
-- What the run was about: the problems found, the project's settings, the
-- lessons and knowledge in force. The same fingerprint means the same answer.
ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS fingerprint TEXT;
