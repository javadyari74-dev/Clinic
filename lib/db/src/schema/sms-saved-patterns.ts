import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// کدهای پترن (bodyId) پرکاربرد ملی‌پیامک که کاربر با یک نام دلخواه ذخیره می‌کند
// تا هنگام «ارسال خدماتی» به‌جای وارد کردن دستی، از فهرست انتخاب کند.
export const smsSavedPatternsTable = sqliteTable("sms_saved_patterns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // نام دلخواه، مثلاً «یادآوری نوبت لیزر»
  name: text("name").notNull(),
  // کد پترن ثبت‌شده در پنل ملی‌پیامک (فقط رقم)
  bodyId: text("body_id").notNull(),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export type SmsSavedPattern = typeof smsSavedPatternsTable.$inferSelect;
