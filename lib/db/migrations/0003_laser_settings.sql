CREATE TABLE IF NOT EXISTS `laser_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`commission_rate` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `laser_settings` (`id`, `commission_rate`) VALUES (1, 0);
