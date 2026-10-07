-- Migration 0019 — ROC radio input (roc.olresultat.se)
--
-- competitions.roc_competition_id  ROC's unitId for the club ("2380"); NULL = none.
-- competitions.roc_enabled         polling on/off (default off).
-- competitions.roc_start_id        first ROC row id that belongs to this
--                                  competition; rows with a lower id are
--                                  history and are skipped (never by timestamp).
-- competitions.roc_last_id         last ROC row id received, so a restart
--                                  resumes where it stopped.
--
-- The unique index makes a radio punch idempotent: the same card+code+time of
-- day arriving twice (two sender types) is stored once. It covers radio_punch
-- events only (partial index).
--
-- Hand-written like 0011–0018, no snapshot.
ALTER TABLE `competitions` ADD `roc_competition_id` text;--> statement-breakpoint
ALTER TABLE `competitions` ADD `roc_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `competitions` ADD `roc_start_id` integer;--> statement-breakpoint
ALTER TABLE `competitions` ADD `roc_last_id` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_events_radio_punch` ON `events` (`competition_id`, json_extract(`payload`, '$.idempotency_key')) WHERE `event_type` = 'radio_punch';
