-- Migration 0025 — entry fees and card rental (SOFT TR 4.12.4, TR 4.12.6)
--
-- classes.entry_fee: the class fee in whole kronor (Eventor's ordinary
-- fee, or set by hand); youth_entry_fee: the lower youth fee of an open
-- class (NULL = same as entry_fee); late_fee_pct: the organiser's late /
-- walk-up surcharge in percent of the fee (Eventor's valueOperator
-- "percent"), capped per class type when charged (fees.ts). NULL = not set.
-- competitions.card_fee: the card rental fee in kronor; NULL = none.
-- competitors.entry_fee / late_fee: what a runner registered in fartOLa
-- was told to pay (class fee and capped surcharge), fixed at
-- registration; NULL for pre-entries, whose fee Eventor decided.
-- hired_cards.fee: the rental fee charged for the card, fixed when the
-- rental opens; NULL = none.
--
-- Hand-written like 0011–0024, no snapshot.
ALTER TABLE `classes` ADD `entry_fee` integer;
--> statement-breakpoint
ALTER TABLE `classes` ADD `youth_entry_fee` integer;
--> statement-breakpoint
ALTER TABLE `classes` ADD `late_fee_pct` integer;
--> statement-breakpoint
ALTER TABLE `competitions` ADD `card_fee` integer;
--> statement-breakpoint
ALTER TABLE `competitors` ADD `entry_fee` integer;
--> statement-breakpoint
ALTER TABLE `competitors` ADD `late_fee` integer;
--> statement-breakpoint
ALTER TABLE `hired_cards` ADD `fee` integer;
