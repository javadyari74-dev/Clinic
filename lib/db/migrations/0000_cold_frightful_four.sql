CREATE TABLE IF NOT EXISTS `patients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_number` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`email` text,
	`birthdate` text,
	`gender` text,
	`notes` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `patients_file_number_unique` ON `patients` (`file_number`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `services` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`duration_minutes` integer,
	`price` integer NOT NULL,
	`doctor_fee` integer DEFAULT 0,
	`material_cost` integer DEFAULT 0,
	`other_cost` integer DEFAULT 0,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `staff` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`role` text,
	`phone` text,
	`email` text,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `discounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`type` text NOT NULL,
	`value` integer NOT NULL,
	`min_amount` integer,
	`usage_limit` integer,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`start_date` text,
	`end_date` text,
	`is_active` integer DEFAULT true NOT NULL,
	`description` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `discounts_code_unique` ON `discounts` (`code`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `appointments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`patient_id` integer NOT NULL,
	`service_id` integer NOT NULL,
	`staff_id` integer,
	`scheduled_at` integer NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`notes` text,
	`price` integer,
	`discount_id` integer,
	`original_price` integer,
	`deposit` integer,
	`session_number` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`appointment_id` integer NOT NULL,
	`discount_id` integer,
	`original_amount` integer NOT NULL,
	`amount` integer NOT NULL,
	`method` text NOT NULL,
	`paid_at` integer NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `inventory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`unit` text,
	`quantity` integer DEFAULT 0 NOT NULL,
	`min_quantity` integer DEFAULT 0 NOT NULL,
	`cost_price` integer,
	`sale_price` integer,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `commission_recipients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`description` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `commissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipient_type` text NOT NULL,
	`recipient_id` integer NOT NULL,
	`appointment_id` integer,
	`description` text,
	`amount` integer NOT NULL,
	`rate` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`is_paid` integer DEFAULT false NOT NULL,
	`paid_at` integer,
	`notes` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`type` text DEFAULT 'custom' NOT NULL,
	`patient_id` integer,
	`due_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `patient_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`patient_id` integer NOT NULL,
	`content` text NOT NULL,
	`kind` text DEFAULT 'general' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `activity_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer,
	`description` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`amount` integer NOT NULL,
	`description` text NOT NULL,
	`date` integer NOT NULL,
	`service_id` integer,
	`staff_id` integer,
	`created_at` integer NOT NULL
);
