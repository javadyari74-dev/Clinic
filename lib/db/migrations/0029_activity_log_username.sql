ALTER TABLE `activity_log` ADD COLUMN `username` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `activity_log_created_at_idx` ON `activity_log` (`created_at`);
