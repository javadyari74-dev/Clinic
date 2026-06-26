import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const paymentsTable = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  appointmentId: integer("appointment_id").notNull(),
  discountId: integer("discount_id"),
  originalAmount: integer("original_amount").notNull(),
  amount: integer("amount").notNull(),
  method: text("method").notNull(),
  paidAt: integer("paid_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
  notes: text("notes"),
  // اسنپ‌شات جزئیات رسید تا هر پرداخت به‌صورت کامل و دائمی در صندوق ثبت بماند
  patientName: text("patient_name"),
  serviceName: text("service_name"),
  sessionNumber: integer("session_number"),
  unitsUsed: integer("units_used"),
  unitLabel: text("unit_label"),
  discountName: text("discount_name"),
  discountAmount: integer("discount_amount"),
  depositAmount: integer("deposit_amount"),
}, (table) => [
  index("payments_paid_at_idx").on(table.paidAt),
  index("payments_appt_paid_idx").on(table.appointmentId, table.paidAt),
]);

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, paidAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
