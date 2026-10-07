-- Migration 0021 — competitors.seed_group (SOFT TR 7.4.5, TR 7.5.1)
--
-- The runner's seeding group in an elite class: 1 = strongest, 2 = next, …;
-- NULL = not seeded (drawn last as the weakest group). Set by
-- PUT …/lottning/:classId/seeding, read by the Seeded draw, so a redraw uses
-- the same groups. fartOLa has no ranking, so the organiser picks them.
--
-- Hand-written like 0011–0020, no snapshot.
ALTER TABLE `competitors` ADD `seed_group` integer;
