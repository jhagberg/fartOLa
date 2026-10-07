-- Migration 0011 — classes.course_id (02.1-14 Task 4)
--
-- Classes point at courses, so many classes can share one course (a real
-- day has 44 classes on 23 courses). courses.class_id stays for back-compat;
-- readers use classes.course_id first and fall back to it.
--
-- Hand-written: drizzle-kit generate rejects the 0009/0010 snapshots as
-- malformed, so no snapshot accompanies this file.
ALTER TABLE `classes` ADD `course_id` text REFERENCES `courses`(`id`) ON DELETE SET NULL;
