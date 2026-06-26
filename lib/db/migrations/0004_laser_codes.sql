ALTER TABLE `laser_services` ADD COLUMN `code` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `laser_services_code_unique` ON `laser_services` (`code`);
--> statement-breakpoint
ALTER TABLE `laser_appointments` ADD COLUMN `appointment_code` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `laser_appointments_appointment_code_unique` ON `laser_appointments` (`appointment_code`);
