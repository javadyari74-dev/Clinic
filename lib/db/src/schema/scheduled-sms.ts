import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// پیامک‌های زمان‌بندی‌شده‌ای که ارسال شده‌اند (یادآوری نوبت روز قبل، یادآوری برگشت،
// تبریک تولد). کلید یکتای هر پیامک (مثلاً «appointment:12:1793880000000») تضمین می‌کند
// که با هر بار باز شدن برنامه یا هر دور بررسی، یک پیامک دوبار فرستاده نشود.
// دادهٔ عملیاتی همین دستگاه است و جزو پشتیبان‌گیری/بازیابی نیست.
export const scheduledSmsTable = sqliteTable("scheduled_sms", {
  key: text("key").primaryKey(),
  kind: text("kind").notNull(),
  // "sent" | "failed" | "pending"
  status: text("status").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastAttemptAt: integer("last_attempt_at").notNull().default(0),
  createdAt: integer("created_at").notNull().default(0),
});

export type ScheduledSms = typeof scheduledSmsTable.$inferSelect;
