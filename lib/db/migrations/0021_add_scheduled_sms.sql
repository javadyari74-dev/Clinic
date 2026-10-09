CREATE TABLE IF NOT EXISTS `scheduled_sms` (
`key` text PRIMARY KEY NOT NULL,
`kind` text NOT NULL,
`status` text NOT NULL,
`attempts` integer DEFAULT 0 NOT NULL,
`last_attempt_at` integer DEFAULT 0 NOT NULL,
`created_at` integer DEFAULT 0 NOT NULL
);
