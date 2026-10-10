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
-- competitors.eventor_entry_fee_id / eventor_late_fee_id: the Eventor fee
-- ids behind those charges, fixed with them so a later class or fee change
-- does not retarget them. competitors.card_fee: the rental fee charged to
-- this runner, fixed when their rental opens (a card change keeps it with
-- the renter).
-- hired_cards.fee: the rental fee charged for the card, fixed when the
-- rental opens; NULL = none.
-- classes.eventor_entry_fee_id / eventor_youth_fee_id / eventor_late_fee_id:
-- Eventor's EntryFeeId for the class fee, the youth fee and the late fee,
-- written back as Fee/Id in the ResultList so Eventor can invoice; NULL =
-- not from Eventor, or the class has several fees of that kind.
-- competitors.birth_year: from the Eventor entry or cache, or given at the
-- desk; in an open class it decides youth (SOFT TR 4.12.1, 4.12.6), as
-- MeOS's BirthYear (oEvent.cpp:248). NULL = unknown. PII (REQ-PRIV-002).
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
--> statement-breakpoint
ALTER TABLE `classes` ADD `eventor_entry_fee_id` integer;
--> statement-breakpoint
ALTER TABLE `classes` ADD `eventor_youth_fee_id` integer;
--> statement-breakpoint
ALTER TABLE `classes` ADD `eventor_late_fee_id` integer;
--> statement-breakpoint
ALTER TABLE `competitors` ADD `birth_year` integer;
--> statement-breakpoint
ALTER TABLE `competitors` ADD `eventor_entry_fee_id` integer;
--> statement-breakpoint
ALTER TABLE `competitors` ADD `eventor_late_fee_id` integer;
--> statement-breakpoint
ALTER TABLE `competitors` ADD `card_fee` integer;
