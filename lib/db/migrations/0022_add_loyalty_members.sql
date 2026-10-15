CREATE TABLE IF NOT EXISTS `loyalty_members` (
`patient_id` integer PRIMARY KEY NOT NULL,
`tier` text DEFAULT 'bronze' NOT NULL,
`joined_at` integer DEFAULT 0 NOT NULL,
`tier_updated_at` integer DEFAULT 0 NOT NULL,
`welcomed` integer DEFAULT 0 NOT NULL
);
