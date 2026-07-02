import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// گزارش هر بکاپ خودکار (و بکاپ ایمنی پیش از ادغام): موفق/ناموفق، زمان، نام فایل.
// جزو داده‌های مطب نیست و در پشتیبان‌گیری/بازیابی/ادغام دخالت داده نمی‌شود.
export const backupLogTable = sqliteTable("backup_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  filename: text("filename"),
  status: text("status").notNull(),
  message: text("message"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export type BackupLog = typeof backupLogTable.$inferSelect;
