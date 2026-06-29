ALTER TABLE `patients` ADD COLUMN `tier` text;
--> statement-breakpoint
ALTER TABLE `patients` ADD COLUMN `account_balance` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `patients` ADD COLUMN `referrer_type` text;
--> statement-breakpoint
ALTER TABLE `patients` ADD COLUMN `referrer_id` integer;
--> statement-breakpoint
ALTER TABLE `patients` ADD COLUMN `referrer_rate` integer;
--> statement-breakpoint
CREATE TABLE `patient_account_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`patient_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`type` text NOT NULL,
	`description` text,
	`payment_id` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pat_acct_tx_patient_idx` ON `patient_account_transactions` (`patient_id`);
