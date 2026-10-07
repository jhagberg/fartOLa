-- Migration 0018 — one competition clock (ADR-0012, update 2026-10-07)
--
-- Every timing conversion now uses one fixed UTC offset per competition:
-- the zone's offset at local noon of competitions.date, or
-- competitions.clock_offset_min (minutes) when the operator overrides it —
-- for a night race dated the day it ends, or stations synced on the other
-- offset. NULL = the date's default.
--
-- competitors.start_wall_ms (0015) goes: on a fixed-offset clock a station
-- time in the hour skipped when DST starts is an ordinary epoch, so
-- start_time_ms alone holds every start. No data conversion; stored epochs
-- stay valid. DROP COLUMN needs SQLite ≥ 3.35 (no index, FK or CHECK on
-- it). Hand-written like 0011–0017, no snapshot.
ALTER TABLE `competitions` ADD `clock_offset_min` integer;
--> statement-breakpoint
ALTER TABLE `competitors` DROP COLUMN `start_wall_ms`;
