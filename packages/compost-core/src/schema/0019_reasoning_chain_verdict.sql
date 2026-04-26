-- Migration 0019 — Phase 7 L5 user verdict signal (debate 026 entry-condition unblocker)
--
-- Adds ground-truth user feedback channel to reasoning_chains, ORTHOGONAL to
-- the existing `status` column:
--   verdict (user judgment): NULL | 'confirmed' | 'refined' | 'rejected'
--   status  (system state):  'active' | 'stale' | 'superseded' | 'user_rejected'
--
-- Why orthogonal (S662 decision, 2026-04-26):
--   - status models machine lifecycle (was the chain superseded by a newer
--     policy? archived by GC?). The user can't write status.
--   - verdict models human evaluation. A chain may stay status='active' AND
--     verdict='rejected' so retrieval can still pull it as a labeled
--     negative example without it disappearing from `reason list`.
--
-- Why this matters (debate 024 lesson, applied at L5):
--   LLM self-confidence is fundamentally unreliable — calibration only shapes
--   the distribution of an inherently noisy signal. User verdict is a *new
--   signal channel*, not a denoised version of the old one. Unlocks:
--     1. debate 026 entry condition (≥50% user-confirmed prerequisite)
--     2. β pattern detection (labeled positive set for pattern mining)
--     3. γ retrieval-side confidence formulas (gold labels for calibration)
--
-- Note: existing `status='user_rejected'` is coarser — it removes the chain
-- from `listRecentChains`. New `verdict='rejected'` keeps it visible for
-- cross-reference but flags it as "this chain is wrong" for downstream
-- consumers. The CLI's `verdict rejected` does NOT bump status; an explicit
-- `--archive` flag (deferred, not in this slice) would.

ALTER TABLE reasoning_chains
  ADD COLUMN user_verdict TEXT
  CHECK(user_verdict IS NULL OR user_verdict IN ('confirmed', 'refined', 'rejected'));

ALTER TABLE reasoning_chains
  ADD COLUMN verdict_at TEXT;

ALTER TABLE reasoning_chains
  ADD COLUMN verdict_note TEXT;

CREATE INDEX idx_reasoning_chains_verdict
  ON reasoning_chains(user_verdict)
  WHERE user_verdict IS NOT NULL;
