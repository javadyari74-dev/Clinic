ALTER TABLE `payments` ADD `wallet_amount` integer;
--> statement-breakpoint
ALTER TABLE `payments` ADD `points_amount` integer;
--> statement-breakpoint
UPDATE `loyalty_transactions` SET `amount` = -`amount`
WHERE `type` = 'adjust' AND `amount` > 0 AND EXISTS (
  SELECT 1 FROM `patient_account_transactions` w
  WHERE w.`patient_id` = `loyalty_transactions`.`patient_id` AND w.`type` = 'loyalty_adjust'
    AND w.`amount` = -`loyalty_transactions`.`amount`
    AND ABS(w.`created_at` - `loyalty_transactions`.`created_at`) <= 5
);
