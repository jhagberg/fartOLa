-- Migration 0016 — competitors.eventor_person_id (SOFT TA till TR 7.8.3)
--
-- The runner's person id in Eventor, read from the EntryList import
-- (Person/Id). The IOF ResultList export writes it back so Eventor links
-- each result to the person without manual "koppling". NULL = unknown
-- (walk-up, MeOS merge, or an import without ids).
--
-- Hand-written like 0011–0015, no snapshot.
ALTER TABLE `competitors` ADD `eventor_person_id` integer;
