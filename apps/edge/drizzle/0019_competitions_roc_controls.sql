-- Migration 0019 — radio control lists (ROC)
--
-- competitions.roc_controls       expected radio control codes, comma separated
--                                 ("52,78,100"); NULL = none listed. The watchdog
--                                 flags a listed control with no radio punch at all
--                                 as silent once card punches at it exist.
-- competitions.roc_start_codes    radio codes that are start / check / finish
-- competitions.roc_check_codes    UNITS ("3,13", "2,12,22", "10,20"): ROC rows carry
-- competitions.roc_finish_codes   the SI station's own programmed code. Such a row is
--                                 compared with the card's start/check/finish time
--                                 stamped by that unit. NULL = none.
--
-- Hand-written like 0011–0018, no snapshot.
ALTER TABLE `competitions` ADD `roc_controls` text;--> statement-breakpoint
ALTER TABLE `competitions` ADD `roc_start_codes` text;--> statement-breakpoint
ALTER TABLE `competitions` ADD `roc_check_codes` text;--> statement-breakpoint
ALTER TABLE `competitions` ADD `roc_finish_codes` text;
