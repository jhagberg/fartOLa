CREATE TABLE `event_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`competition_id` text NOT NULL,
	`code` text NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`revoked_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`competition_id`) REFERENCES `competitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_event_codes_comp_code` ON `event_codes` (`competition_id`,`code`);--> statement-breakpoint
CREATE INDEX `idx_event_codes_comp_active` ON `event_codes` (`competition_id`,`expires_at_ms`);
