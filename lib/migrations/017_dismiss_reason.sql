-- Why a recommendation was dismissed. "Wrong" teaches the brain something
-- different from "already did it" or "not relevant to this business".
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS dismiss_reason TEXT
  CHECK (dismiss_reason IN ('not_relevant', 'already_done', 'wrong'));
