import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const appointmentsTable = sqliteTable("appointments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  appointmentCode: text("appointment_code"),
  patientId: integer("patient_id").notNull(),
  serviceId: integer("service_id").notNull(),
  staffId: integer("staff_id"),
  scheduledAt: integer("scheduled_at").notNull(),
  status: text("status").notNull().default("scheduled"),
  notes: text("notes"),
  price: integer("price"),
  discountId: integer("discount_id"),
  originalPrice: integer("original_price"),
  deposit: integer("deposit"),
  sessionNumber: integer("session_number"),
  unitsUsed: integer("units_used"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
}, (table) => [
  index("appointments_service_id_idx").on(table.serviceId),
  index("appointments_patient_id_idx").on(table.patientId),
]);

export const insertAppointmentSchema = createInsertSchema(appointmentsTable).omit({ id: true, createdAt: true });
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointmentsTable.$inferSelect;
