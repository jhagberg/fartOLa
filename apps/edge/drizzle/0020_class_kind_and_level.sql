-- Migration 0020 — class kind, age class and competition level
-- (SOFT TR 3.3.1, TR 3.4.2, 3.4.6, 3.4.9)
--
-- classes.class_kind: the SOFT category (elit, ungdom, junior, senior,
-- veteran, oppen, inskolning; ClassKind in packages/shared-types).
-- classes.age_class: the D/H age of an age class (youngest of a merged
-- class, TR 3.4.7); NULL for open classes. classes.class_kind_source:
-- 'eventor' (ClassTypeId 17 åldersklass / 19 öppen klass), 'name' (SOFT
-- name pattern) or 'operator'. An unknown name has no kind until the
-- operator picks one. Existing rows get the name suggestion from
-- runMigrations (backfillClassKinds).
-- competitions.level: 'niva1' | 'niva2' | 'niva3' | 'niva4' | 'traning';
-- NULL = not set. Rules that depend on kind or level refuse while either
-- is NULL.
--
-- Hand-written like 0011–0019, no snapshot.
ALTER TABLE `classes` ADD `class_kind` text;
--> statement-breakpoint
ALTER TABLE `classes` ADD `age_class` integer;
--> statement-breakpoint
ALTER TABLE `classes` ADD `class_kind_source` text;
--> statement-breakpoint
ALTER TABLE `competitions` ADD `level` text;
