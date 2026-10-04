-- Migration 0015 — competitions.max_time_sec (SOFT TR 4.21.1)
--
-- "Maxtiden är densamma för alla klasser": one max time for the whole
-- competition, in seconds. NULL = none. classes.max_time_sec stays as a
-- per-class override (for non-sanctioned use); the reducer uses the class
-- value when set, else this one.
--
-- Hand-written like 0011–0014, no snapshot.
ALTER TABLE `competitions` ADD `max_time_sec` integer;
