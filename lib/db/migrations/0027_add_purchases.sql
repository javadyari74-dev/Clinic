CREATE TABLE IF NOT EXISTS `purchases` (
`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
`uuid` text NOT NULL,
`product_type` text NOT NULL,
`product_name` text NOT NULL,
`supplier` text,
`quantity` integer DEFAULT 1 NOT NULL,
`price` integer NOT NULL,
`purchase_date` integer NOT NULL,
`is_settled` integer DEFAULT 0 NOT NULL,
`settled_at` integer,
`notes` text,
`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `purchases_uuid_unique` ON `purchases` (`uuid`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `purchases_date_idx` ON `purchases` (`purchase_date`);
