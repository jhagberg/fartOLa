-- Migration 0009 — Partial index on competitions.eventor_event_id
--
-- The eventor_event_id column was added in migration 0007 (plan 02.1-01).
-- This migration adds a partial index so lookups by Eventor event ID
-- (e.g. "find the competition linked to Eventor event 12345") are sub-ms
-- even as the competitions table grows.
--
-- WHERE NOT NULL: unlinked competitions (eventor_event_id IS NULL) are
-- excluded from the index — they would never be looked up by event ID.
--
-- Locked by:
-- - .planning/phases/02.1-sanctioned-competition-foundations/02.1-11-PLAN.md
-- - T-02.1-22 (Spoofing — wizard validates event ID against Eventor API
--   before persisting; this index is a correctness aid, not a security control)
CREATE INDEX `idx_competitions_eventor_event_id`
  ON `competitions` (`eventor_event_id`)
  WHERE `eventor_event_id` IS NOT NULL;
