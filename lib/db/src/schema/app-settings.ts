import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// جدول تنظیمات عمومی برنامه به‌صورت کلید/مقدار (مثلاً مسیر ذخیره بکاپ).
// این جدول جزو داده‌های مطب نیست و در پشتیبان‌گیری/بازیابی/ادغام دخالت داده نمی‌شود.
export const appSettingsTable = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export type AppSetting = typeof appSettingsTable.$inferSelect;
