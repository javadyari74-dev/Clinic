CREATE TABLE IF NOT EXISTS `waiting_list` (
`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
`uuid` text,
`patient_id` integer NOT NULL,
`service_id` integer NOT NULL,
`preferred_from` integer,
`preferred_to` integer,
`note` text,
`status` text DEFAULT 'waiting' NOT NULL,
`appointment_id` integer,
`created_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `waiting_list_uuid_unique` ON `waiting_list` (`uuid`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `waiting_list_patient_id_idx` ON `waiting_list` (`patient_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `waiting_list_status_idx` ON `waiting_list` (`status`);
