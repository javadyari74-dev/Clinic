CREATE TABLE IF NOT EXISTS `service_price_history` (
`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
`uuid` text NOT NULL,
`service_id` integer NOT NULL,
`effective_from` integer NOT NULL,
`price` integer NOT NULL,
`price_mode` text DEFAULT 'total' NOT NULL,
`unit_count` integer DEFAULT 1 NOT NULL,
`doctor_fee` integer DEFAULT 0 NOT NULL,
`doctor_fee_mode` text DEFAULT 'total' NOT NULL,
`material_cost` integer DEFAULT 0 NOT NULL,
`material_cost_mode` text DEFAULT 'total' NOT NULL,
`other_cost` integer DEFAULT 0 NOT NULL,
`other_cost_mode` text DEFAULT 'total' NOT NULL,
`changes` text,
`note` text,
`changed_by` text,
`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `service_price_history_uuid_unique` ON `service_price_history` (`uuid`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `service_price_history_service_idx` ON `service_price_history` (`service_id`, `effective_from`);
--> statement-breakpoint
INSERT INTO `service_price_history` (`uuid`, `service_id`, `effective_from`, `price`, `price_mode`, `unit_count`, `doctor_fee`, `doctor_fee_mode`, `material_cost`, `material_cost_mode`, `other_cost`, `other_cost_mode`, `note`, `created_at`)
SELECT lower(hex(randomblob(16))), s.`id`, 0, s.`price`, COALESCE(s.`price_mode`, 'total'), COALESCE(s.`unit_count`, 1),
  COALESCE(s.`doctor_fee`, 0), COALESCE(s.`doctor_fee_mode`, 'total'), COALESCE(s.`material_cost`, 0), COALESCE(s.`material_cost_mode`, 'total'),
  COALESCE(s.`other_cost`, 0), COALESCE(s.`other_cost_mode`, 'total'), 'قیمت پیش از ثبت تاریخچه', CAST(strftime('%s','now') AS integer)
FROM `services` s
WHERE NOT EXISTS (SELECT 1 FROM `service_price_history` h WHERE h.`service_id` = s.`id`);
