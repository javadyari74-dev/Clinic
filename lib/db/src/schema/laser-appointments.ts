import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const laserAppointmentsTable = sqliteTable("laser_appointments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  appointmentCode: text("appointment_code").unique(),
  clientId: integer("client_id").notNull(),
  serviceId: integer("service_id").notNull(),
  operatorName: text("operator_name"),
  scheduledAt: integer("scheduled_at", { mode: "timestamp" }).notNull(),
  status: text("status", { enum: ["scheduled", "completed", "cancelled"] }).notNull().default("scheduled"),
  sessionNumber: integer("session_number"),
  price: integer("price"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export type LaserAppointment = typeof laserAppointmentsTable.$inferSelect;
