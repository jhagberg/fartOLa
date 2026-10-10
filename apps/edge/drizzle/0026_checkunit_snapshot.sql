-- Migration 0026 — last check-unit snapshot (SOFT TR 4.22.1, kvar i skogen)
--
-- The card numbers from the latest BSF8 backup-memory read are kept so the
-- in-forest list works after the check unit has gone back and with no reader
-- connected. checkunit_cards is a JSON array of card numbers; NULL = never read.
--
-- Hand-written like 0011–0025, no snapshot.
ALTER TABLE `competitions` ADD `checkunit_cards` text;
--> statement-breakpoint
ALTER TABLE `competitions` ADD `checkunit_overflow` integer;
--> statement-breakpoint
ALTER TABLE `competitions` ADD `checkunit_read_at_ms` integer;
