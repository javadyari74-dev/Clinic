CREATE TABLE IF NOT EXISTS `sms_log` (
`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
`recipient_phone` text NOT NULL,
`recipient_name` text,
`patient_id` integer,
`event_type` text NOT NULL,
`message` text NOT NULL,
`status` text NOT NULL,
`error` text,
`created_at` integer DEFAULT 0 NOT NULL
);
