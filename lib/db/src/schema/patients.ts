import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const patientsTable = sqliteTable("patients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fileNumber: text("file_number").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  birthdate: text("birthdate"),
  gender: text("gender"),
  notes: text("notes"),
  tier: text("tier"),
  accountBalance: integer("account_balance").notNull().default(0),
  referrerType: text("referrer_type"),
  referrerId: integer("referrer_id"),
  referrerRate: integer("referrer_rate"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const insertPatientSchema = createInsertSchema(patientsTable).omit({ id: true, createdAt: true });
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type Patient = typeof patientsTable.$inferSelect;

export const patientAccountTransactionsTable = sqliteTable("patient_account_transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  patientId: integer("patient_id").notNull(),
  amount: integer("amount").notNull(),
  type: text("type").notNull(),
  description: text("description"),
  paymentId: integer("payment_id"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const insertPatientAccountTransactionSchema = createInsertSchema(patientAccountTransactionsTable).omit({ id: true, createdAt: true });
export type InsertPatientAccountTransaction = z.infer<typeof insertPatientAccountTransactionSchema>;
export type PatientAccountTransaction = typeof patientAccountTransactionsTable.$inferSelect;
