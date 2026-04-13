-- Migration 0008_phase3_ranking.sql
-- Source: Debate 9 synthesis (2026-04-13)
-- Creates: rp-phase3-default profile with w4_importance active.
-- Supersedes rp-phase2-default.

INSERT INTO ranking_profile (profile_id, name, w1_semantic, w2_temporal, w3_access, w4_importance)
VALUES ('rp-phase3-default', 'Phase 3 semantic + temporal + access + importance', 1.2, 0.15, 0.1, 0.1);

-- Mark rp-phase2-default as superseded
UPDATE ranking_profile SET superseded_by = 'rp-phase3-default' WHERE profile_id = 'rp-phase2-default';
