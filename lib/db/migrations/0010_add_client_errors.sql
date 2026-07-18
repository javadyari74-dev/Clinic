CREATE TABLE `client_errors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message` text NOT NULL,
	`stack` text,
	`component_stack` text,
	`url` text,
	`user_agent` text,
	`occurred_at` text,
	`created_at` integer NOT NULL
);
