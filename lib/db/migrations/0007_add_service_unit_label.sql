ALTER TABLE `services` ADD COLUMN `unit_count` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `services` ADD COLUMN `unit_label` text;
--> statement-breakpoint
ALTER TABLE `services` ADD COLUMN `price_mode` text DEFAULT 'total' NOT NULL;
--> statement-breakpoint
ALTER TABLE `services` ADD COLUMN `doctor_fee_mode` text DEFAULT 'total' NOT NULL;
--> statement-breakpoint
ALTER TABLE `services` ADD COLUMN `material_cost_mode` text DEFAULT 'total' NOT NULL;
--> statement-breakpoint
ALTER TABLE `services` ADD COLUMN `other_cost_mode` text DEFAULT 'total' NOT NULL;
--> statement-breakpoint
ALTER TABLE `appointments` ADD COLUMN `units_used` integer;
--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `patient_name` text;
--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `service_name` text;
--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `session_number` integer;
--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `units_used` integer;
--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `unit_label` text;
--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `discount_name` text;
--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `discount_amount` integer;
--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `deposit_amount` integer;
