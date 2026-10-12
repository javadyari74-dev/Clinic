CREATE TABLE IF NOT EXISTS `purchase_products` (
`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
`uuid` text NOT NULL,
`product_type` text NOT NULL,
`name` text NOT NULL,
`default_supplier` text,
`default_price` integer,
`notes` text,
`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `purchase_products_uuid_unique` ON `purchase_products` (`uuid`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `purchase_products_type_name_unique` ON `purchase_products` (`product_type`, `name`);
