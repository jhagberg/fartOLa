-- Migration 0019 — competitions.roc_controls
--
-- Expected radio control codes, comma separated ("52,78,100"); NULL = none
-- listed. The watchdog flags a listed control with no radio punch at all as
-- silent once card punches at it exist.
--
-- Hand-written like 0011–0018, no snapshot.
ALTER TABLE `competitions` ADD `roc_controls` text;
