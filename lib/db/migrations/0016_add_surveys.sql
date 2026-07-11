CREATE TABLE IF NOT EXISTS `surveys` (
`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
`uuid` text NOT NULL,
`patient_id` integer NOT NULL,
`appointment_id` integer,
`payment_id` integer,
`service_id` integer,
`staff_id` integer,
`sent_at` integer NOT NULL,
`sms_status` text DEFAULT 'pending' NOT NULL,
`score` integer,
`comment` text,
`scored_at` integer,
`created_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `surveys_uuid_unique` ON `surveys` (`uuid`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `surveys_patient_id_idx` ON `surveys` (`patient_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `surveys_sent_at_idx` ON `surveys` (`sent_at`);
