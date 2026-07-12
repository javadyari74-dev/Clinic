CREATE TABLE IF NOT EXISTS `loyalty_transactions` (
`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
`uuid` text NOT NULL,
`patient_id` integer NOT NULL,
`payment_id` integer,
`delta` integer NOT NULL,
`amount` integer DEFAULT 0 NOT NULL,
`type` text NOT NULL,
`description` text,
`created_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `loyalty_transactions_uuid_unique` ON `loyalty_transactions` (`uuid`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `loyalty_txns_patient_id_idx` ON `loyalty_transactions` (`patient_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `loyalty_txns_payment_id_idx` ON `loyalty_transactions` (`payment_id`);
