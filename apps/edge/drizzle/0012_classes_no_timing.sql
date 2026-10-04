-- Migration 0012 — classes.no_timing (02.1-14 Task 9)
--
-- Classes without timing (MeOS oClass.NoTiming, IOF
-- resultListMode="UnorderedNoTimes"): status is computed as usual, but no
-- running time or place is shown or exported.
--
-- Hand-written like 0011: drizzle-kit generate rejects the 0009/0010
-- snapshots as malformed, so no snapshot accompanies this file.
ALTER TABLE `classes` ADD `no_timing` integer DEFAULT false NOT NULL;
