import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "node:crypto";

// لیست انتظار نوبت: وقتی روز موردنظر مراجع پر است، او را با خدمت و بازه تاریخ
// دلخواه در صف نگه می‌داریم تا با خالی شدن جای نوبت (مثلاً لغو)، منشی بتواند
// با یک کلیک نوبت واقعی ثبت کند یا با پیامک اطلاع دهد.
export const waitingListTable = sqliteTable("waiting_list", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  uuid: text("uuid").notNull().unique().$defaultFn(() => randomUUID()),
  patientId: integer("patient_id").notNull(),
  serviceId: integer("service_id").notNull(),
  // بازه تاریخ دلخواه مراجع (ثانیه یونیکس)؛ هر دو اختیاری‌اند
  preferredFrom: integer("preferred_from"),
  preferredTo: integer("preferred_to"),
  note: text("note"),
  // waiting | fulfilled | cancelled
  status: text("status").notNull().default("waiting"),
  // نوبتی که این درخواست با آن تبدیل/برآورده شد (در صورت وجود)
  appointmentId: integer("appointment_id"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
}, (table) => [
  index("waiting_list_patient_id_idx").on(table.patientId),
  index("waiting_list_status_idx").on(table.status),
]);

export const insertWaitingListSchema = createInsertSchema(waitingListTable).omit({ id: true, uuid: true, createdAt: true });
export type InsertWaitingListEntry = z.infer<typeof insertWaitingListSchema>;
export type WaitingListEntry = typeof waitingListTable.$inferSelect;
