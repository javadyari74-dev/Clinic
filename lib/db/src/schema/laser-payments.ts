import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const laserPaymentsTable = sqliteTable("laser_payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  appointmentId: integer("appointment_id").notNull(),
  amount: integer("amount").notNull(),
  method: text("method").notNull().default("cash"),
  operatorName: text("operator_name"),
  commissionAmount: integer("commission_amount").notNull().default(0),
  notes: text("notes"),
  nextSessionDate: text("next_session_date"),
  nextSessionNote: text("next_session_note"),
  paidAt: integer("paid_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export type LaserPayment = typeof laserPaymentsTable.$inferSelect;
