CREATE TABLE IF NOT EXISTS `laser_clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_number` text NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`gender` text NOT NULL,
	`email` text,
	`birthdate` text,
	`skin_type` text,
	`hair_color` text,
	`medical_history` text,
	`notes` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `laser_clients_file_number_unique` ON `laser_clients` (`file_number`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `laser_services` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`gender_category` text NOT NULL,
	`price` integer NOT NULL,
	`commission_rate` integer DEFAULT 0 NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `laser_appointments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` integer NOT NULL,
	`service_id` integer NOT NULL,
	`operator_name` text,
	`scheduled_at` integer NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`session_number` integer,
	`price` integer,
	`notes` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `laser_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`appointment_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`method` text DEFAULT 'cash' NOT NULL,
	`operator_name` text,
	`commission_amount` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`paid_at` integer NOT NULL
);
