ALTER TABLE `commissions` ADD COLUMN `payment_id` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `commissions_payment_idx` ON `commissions` (`payment_id`);
