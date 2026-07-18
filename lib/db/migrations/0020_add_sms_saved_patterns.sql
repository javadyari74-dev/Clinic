CREATE TABLE IF NOT EXISTS `sms_saved_patterns` (
`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
`name` text NOT NULL,
`body_id` text NOT NULL,
`created_at` integer DEFAULT 0 NOT NULL
);
