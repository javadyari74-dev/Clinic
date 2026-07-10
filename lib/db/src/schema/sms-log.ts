import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// تاریخچه پیامک‌های ارسال‌شده از پنل ملی‌پیامک.
// هر تلاش ارسال (موفق یا ناموفق) یک ردیف ثبت می‌شود تا کاربر بتواند در تب
// «تاریخچه ارسال» ببیند چه پیامکی، برای چه کسی و با چه نتیجه‌ای رفته است.
export const smsLogTable = sqliteTable("sms_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // شماره گیرنده به شکل نرمال‌شده (09xxxxxxxxx)
  recipientPhone: text("recipient_phone").notNull(),
  // نام گیرنده (بیمار/معرف) برای نمایش در تاریخچه؛ ممکن است خالی باشد
  recipientName: text("recipient_name"),
  patientId: integer("patient_id"),
  // نوع رویداد: appointment | payment | commission | birthday | manual
  eventType: text("event_type").notNull(),
  message: text("message").notNull(),
  // sent | failed
  status: text("status").notNull(),
  error: text("error"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export type SmsLog = typeof smsLogTable.$inferSelect;
