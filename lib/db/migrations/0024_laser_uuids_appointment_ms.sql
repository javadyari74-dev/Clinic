-- 0024: شناسهٔ یکتا (uuid) برای جدول‌های لیزر تا در بازیابی ادغامی پوشش داده شوند،
-- و تبدیل زمان نوبت‌هایی که به‌اشتباه بر حسب ثانیه ذخیره شده‌اند به میلی‌ثانیه.
-- همهٔ دستورها idempotent هستند (اجرای دوباره در هر راه‌اندازی بی‌اثر است).
ALTER TABLE `laser_clients` ADD COLUMN `uuid` text;
--> statement-breakpoint
UPDATE `laser_clients` SET `uuid` = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE `uuid` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `laser_clients_uuid_unique` ON `laser_clients` (`uuid`);
--> statement-breakpoint
ALTER TABLE `laser_services` ADD COLUMN `uuid` text;
--> statement-breakpoint
UPDATE `laser_services` SET `uuid` = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE `uuid` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `laser_services_uuid_unique` ON `laser_services` (`uuid`);
--> statement-breakpoint
ALTER TABLE `laser_appointments` ADD COLUMN `uuid` text;
--> statement-breakpoint
UPDATE `laser_appointments` SET `uuid` = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE `uuid` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `laser_appointments_uuid_unique` ON `laser_appointments` (`uuid`);
--> statement-breakpoint
ALTER TABLE `laser_payments` ADD COLUMN `uuid` text;
--> statement-breakpoint
UPDATE `laser_payments` SET `uuid` = lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))) WHERE `uuid` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `laser_payments_uuid_unique` ON `laser_payments` (`uuid`);
--> statement-breakpoint
-- نوبت‌هایی که scheduled_at آن‌ها ثانیه است (کمتر از 1e11 ≈ سال ۱۹۷۳ به میلی‌ثانیه)
UPDATE `appointments` SET `scheduled_at` = `scheduled_at` * 1000 WHERE `scheduled_at` > 0 AND `scheduled_at` < 100000000000;
