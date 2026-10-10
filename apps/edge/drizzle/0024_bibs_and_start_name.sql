-- Migration 0024 — bibs and start place (SOFT TR 7.5.4)
--
-- competitors.bib: the runner's bib (startnummer), text because a prefix
-- may come with it ('A101'; MeOS Bib is text too). Unique per competition
-- when set. Assigned in start order by POST …/lottning/:classId/bibs or
-- changed by hand; NULL = no bib.
-- classes.bib_prefix / bib_base: the class's bib numbering, OLA's
-- "Nummerlappsprefix" and "Nummerlappsnummer bas"; NULL = none.
-- classes.start_name: the class's start place ("Start 1"); NULL = unknown.
--
-- Hand-written like 0011–0023, no snapshot.
ALTER TABLE `competitors` ADD `bib` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `competitors_bib_per_comp` ON `competitors` (`competition_id`,`bib`) WHERE "competitors"."bib" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `classes` ADD `bib_prefix` text;
--> statement-breakpoint
ALTER TABLE `classes` ADD `bib_base` integer;
--> statement-breakpoint
ALTER TABLE `classes` ADD `start_name` text;
