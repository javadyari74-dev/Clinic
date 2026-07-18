ALTER TABLE `services` ADD COLUMN `service_code` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `services_service_code_unique` ON `services` (`service_code`);
--> statement-breakpoint
ALTER TABLE `appointments` ADD COLUMN `appointment_code` text;
--> statement-breakpoint
UPDATE `services` SET `service_code` = 'SRV-' || printf('%04d', `id`) WHERE `service_code` IS NULL;
