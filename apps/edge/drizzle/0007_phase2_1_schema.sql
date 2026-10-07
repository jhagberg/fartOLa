CREATE TABLE `course_replacements` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`course_id` text NOT NULL,
	`control_code` integer NOT NULL,
	`alternative_code` integer NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_replacements_unique` ON `course_replacements` (`course_id`,`control_code`,`alternative_code`);--> statement-breakpoint
ALTER TABLE `classes` ADD `first_start_ms` integer;--> statement-breakpoint
ALTER TABLE `classes` ADD `start_interval_sec` integer;--> statement-breakpoint
ALTER TABLE `classes` ADD `max_time_sec` integer;--> statement-breakpoint
ALTER TABLE `competitions` ADD `liveresultat_id` text;--> statement-breakpoint
ALTER TABLE `competitions` ADD `liveresultat_pwd` text;--> statement-breakpoint
ALTER TABLE `competitions` ADD `eventor_event_id` integer;--> statement-breakpoint
ALTER TABLE `competitions` ADD `timing_format` text DEFAULT 'seconds';--> statement-breakpoint
ALTER TABLE `competitors` ADD `start_time_ms` integer;