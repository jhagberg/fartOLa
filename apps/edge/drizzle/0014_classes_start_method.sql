-- Migration 0014 — classes.start_method (02.1-14 Task 14)
--
-- Which start a running time is measured from, per class:
--   'auto'        the runner's start time when there is one, else the start
--                 punch (open classes / fri starttid, SOFT TR 7.4.3 (2026-07-01))
--   'start_time'  the start time only; start punches are ignored
--                 (SOFT TR 4.18.9 (2026-07-01): ursprunglig starttid gäller)
--   'start_punch' the start punch, else the start time (MeOS default)
--
-- Replaces 0013's unreleased ignore_start_punch: true → 'start_time',
-- false → 'auto'. The old column is dropped with ALTER TABLE DROP COLUMN
-- (SQLite ≥ 3.35; the column has no index, FK or CHECK, so no table
-- rebuild is needed). Hand-written like 0011–0013, no snapshot.
ALTER TABLE `classes` ADD `start_method` text DEFAULT 'auto' NOT NULL;
--> statement-breakpoint
UPDATE `classes` SET `start_method` = 'start_time' WHERE `ignore_start_punch` = 1;
--> statement-breakpoint
ALTER TABLE `classes` DROP COLUMN `ignore_start_punch`;
