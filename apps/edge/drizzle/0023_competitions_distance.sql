-- Migration 0023 — competition distance (SOFT TA till TR 7.4.4, TR 4.21.1)
--
-- competitions.distance: 'sprint' | 'medel' | 'lang' | 'ultralang' |
-- 'natt'; NULL = not set. The distance gives the normal start interval
-- (sprint 1, medel and natt 2, lång 3 minutes, ultralång mass start) the
-- draw suggests when a class has none.
--
-- Hand-written like 0011–0022, no snapshot.
ALTER TABLE `competitions` ADD `distance` text;
