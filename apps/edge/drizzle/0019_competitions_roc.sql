-- Migration 0019 — ROC radio input (roc.olresultat.se)
--
-- competitions.roc_competition_id  ROC's unitId for the club ("2380"); NULL = none.
-- competitions.roc_enabled         polling on/off (default off).
-- competitions.roc_start_id        first ROC row id that belongs to this
--                                  competition; rows with a lower id are
--                                  history and are skipped (never by timestamp).
-- competitions.roc_last_id         last ROC row id received, so a restart
--                                  resumes where it stopped.
-- competitions.roc_controls        expected radio control codes, comma separated
--                                  ("52,78,100"); NULL = none listed. A listed one
--                                  with no radio punch is silent once card punches
--                                  at it exist.
-- competitions.roc_start_codes     radio codes that are start / check / finish
-- competitions.roc_check_codes     UNITS ("3,13", "2,12,22", "10,20"): ROC rows carry
-- competitions.roc_finish_codes    the SI station's own programmed code. Such a row
--                                  is compared with the card's start/check/finish
--                                  time stamped by that unit. NULL = none.
--
-- The unique index makes a ROC row idempotent: its key is unit:row id, so a
-- row fetched twice is stored once. It covers radio_punch events only
-- (partial index). The same punch via two sender types is two rows and is
-- collapsed on (card, code, time of day) when read.
--
-- Hand-written like 0011–0018, no snapshot.
ALTER TABLE `competitions` ADD `roc_competition_id` text;--> statement-breakpoint
ALTER TABLE `competitions` ADD `roc_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `competitions` ADD `roc_start_id` integer;--> statement-breakpoint
ALTER TABLE `competitions` ADD `roc_last_id` integer;--> statement-breakpoint
ALTER TABLE `competitions` ADD `roc_controls` text;--> statement-breakpoint
ALTER TABLE `competitions` ADD `roc_start_codes` text;--> statement-breakpoint
ALTER TABLE `competitions` ADD `roc_check_codes` text;--> statement-breakpoint
ALTER TABLE `competitions` ADD `roc_finish_codes` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_events_radio_punch` ON `events` (`competition_id`, json_extract(`payload`, '$.idempotency_key')) WHERE `event_type` = 'radio_punch';
