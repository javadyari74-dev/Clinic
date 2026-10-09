ALTER TABLE `reminders` ADD `payment_id` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `reminders_payment_id_idx` ON `reminders` (`payment_id`);
--> statement-breakpoint
UPDATE `appointments` SET `price` = (
  SELECT p.`original_amount` - COALESCE(p.`discount_amount`, 0) FROM `payments` p
  WHERE p.`appointment_id` = `appointments`.`id` AND COALESCE(p.`notes`, '') <> 'بیعانه'
  ORDER BY p.`id` DESC LIMIT 1
)
WHERE `price` IS NULL AND EXISTS (
  SELECT 1 FROM `payments` p
  WHERE p.`appointment_id` = `appointments`.`id` AND COALESCE(p.`notes`, '') <> 'بیعانه'
);
