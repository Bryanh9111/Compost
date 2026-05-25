-- Migration 0023 — speed up integrity scans over processed observations.
--
-- `doctor --check-integrity` needs to distinguish truly orphaned observations
-- from observations that were processed into action_log instead of L1/L2
-- derivations. The original derivation_run indexes are partial and include
-- layer/policy dimensions, so a plain observe_id lookup can become expensive
-- on large ledgers.

CREATE INDEX IF NOT EXISTS idx_derivation_run_observe_id
  ON derivation_run(observe_id);
