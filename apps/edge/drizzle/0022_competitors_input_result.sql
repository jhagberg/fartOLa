-- Migration 0022 — competitors.input_time_ms / input_status (SOFT TR 7.4.1)
--
-- The runner's result from an earlier stage, imported from an IOF XML 3.0
-- ResultList (day 1 exported from MeOS, OLA or Eventor) for a pursuit or
-- reverse pursuit. Named after MeOS's oRunner inputTime / inputStatus.
-- input_time_ms: running time in whole seconds as ms (OverallResult when
-- the file has one, else Result); input_status: the IOF ResultStatus
-- ('OK', 'MissingPunch', …). NULL/NULL = no matching result.
--
-- Hand-written like 0011–0021, no snapshot.
ALTER TABLE `competitors` ADD `input_time_ms` integer;
--> statement-breakpoint
ALTER TABLE `competitors` ADD `input_status` text;
