ALTER TABLE `patients` ADD COLUMN `uuid` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `patients_uuid_unique` ON `patients` (`uuid`);
--> statement-breakpoint
ALTER TABLE `appointments` ADD COLUMN `uuid` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `appointments_uuid_unique` ON `appointments` (`uuid`);
--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `uuid` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `payments_uuid_unique` ON `payments` (`uuid`);
--> statement-breakpoint
ALTER TABLE `services` ADD COLUMN `uuid` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `services_uuid_unique` ON `services` (`uuid`);
--> statement-breakpoint
ALTER TABLE `staff` ADD COLUMN `uuid` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `staff_uuid_unique` ON `staff` (`uuid`);
--> statement-breakpoint
ALTER TABLE `discounts` ADD COLUMN `uuid` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `discounts_uuid_unique` ON `discounts` (`uuid`);
--> statement-breakpoint
ALTER TABLE `inventory` ADD COLUMN `uuid` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `inventory_uuid_unique` ON `inventory` (`uuid`);
--> statement-breakpoint
ALTER TABLE `commissions` ADD COLUMN `uuid` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `commissions_uuid_unique` ON `commissions` (`uuid`);
--> statement-breakpoint
ALTER TABLE `commission_recipients` ADD COLUMN `uuid` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `commission_recipients_uuid_unique` ON `commission_recipients` (`uuid`);
--> statement-breakpoint
ALTER TABLE `reminders` ADD COLUMN `uuid` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `reminders_uuid_unique` ON `reminders` (`uuid`);
--> statement-breakpoint
ALTER TABLE `patient_notes` ADD COLUMN `uuid` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `patient_notes_uuid_unique` ON `patient_notes` (`uuid`);
--> statement-breakpoint
ALTER TABLE `activity_log` ADD COLUMN `uuid` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `activity_log_uuid_unique` ON `activity_log` (`uuid`);
--> statement-breakpoint
ALTER TABLE `expenses` ADD COLUMN `uuid` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `expenses_uuid_unique` ON `expenses` (`uuid`);
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `uuid` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_uuid_unique` ON `users` (`uuid`);
--> statement-breakpoint
ALTER TABLE `patient_account_transactions` ADD COLUMN `uuid` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `patient_account_transactions_uuid_unique` ON `patient_account_transactions` (`uuid`);
