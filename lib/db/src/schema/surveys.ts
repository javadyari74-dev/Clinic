import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { randomUUID } from "node:crypto";

// نظرسنجی رضایت مراجعین پس از مراجعه: پس از ثبت پرداخت (پایان مراجعه)، پیامک
// نظرسنجی برای بیمار ارسال و همین‌جا یک ردیف ثبت می‌شود. چون برنامه آفلاین است
// و دریافت پاسخ پیامکی نداریم، امتیاز (۱ تا ۵) را منشی در تماس بعدی به‌صورت
// دستی ثبت می‌کند. مرجع خدمت/کارمند از نوبتِ همان پرداخت در لحظه ارسال ذخیره
// می‌شود تا گزارش رضایت به تفکیک خدمت و کارمند پایدار بماند.
export const surveysTable = sqliteTable("surveys", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  uuid: text("uuid").notNull().unique().$defaultFn(() => randomUUID()),
  patientId: integer("patient_id").notNull(),
  appointmentId: integer("appointment_id"),
  paymentId: integer("payment_id"),
  serviceId: integer("service_id"),
  staffId: integer("staff_id"),
  // زمان ارسال پیامک نظرسنجی (ثانیه یونیکس) — مبنای محدودیت تکرار و بازه گزارش
  sentAt: integer("sent_at").notNull(),
  // نتیجه ارسال پیامک: pending (در حال ارسال) | sent | failed
  smsStatus: text("sms_status").notNull().default("pending"),
  // امتیاز ۱ تا ۵؛ خالی یعنی هنوز ثبت نشده (در انتظار)
  score: integer("score"),
  comment: text("comment"),
  // زمان ثبت امتیاز توسط منشی (ثانیه یونیکس)
  scoredAt: integer("scored_at"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
}, (table) => [
  index("surveys_patient_id_idx").on(table.patientId),
  index("surveys_sent_at_idx").on(table.sentAt),
]);

export type Survey = typeof surveysTable.$inferSelect;
export type InsertSurvey = typeof surveysTable.$inferInsert;
