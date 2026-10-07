-- Migration 0013 — classes.ignore_start_punch (02.1-14 Task 11)
--
-- Classes that ignore start punches (MeOS "Ej startstämpling", IgnoreStart):
-- a runner with a drawn start is timed from it even if the card has a start
-- punch. Otherwise the start punch replaces the drawn start, as in MeOS.
--
-- Hand-written like 0011/0012: drizzle-kit generate rejects the 0009/0010
-- snapshots as malformed, so no snapshot accompanies this file.
ALTER TABLE `classes` ADD `ignore_start_punch` integer DEFAULT false NOT NULL;
