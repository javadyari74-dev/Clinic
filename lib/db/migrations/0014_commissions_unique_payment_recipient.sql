DELETE FROM `commissions` WHERE `payment_id` IS NOT NULL AND `id` NOT IN (
  SELECT MIN(`id`) FROM `commissions` WHERE `payment_id` IS NOT NULL
  GROUP BY `payment_id`, `recipient_type`, `recipient_id`
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `commissions_payment_recipient_unique` ON `commissions` (`payment_id`,`recipient_type`,`recipient_id`) WHERE `payment_id` IS NOT NULL;
