import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "node:crypto";

export const patientAccountTransactionsTable = sqliteTable("patient_account_transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  uuid: text("uuid").notNull().unique().$defaultFn(() => randomUUID()),
  patientId: integer("patient_id").notNull(),
  amount: integer("amount").notNull(),
  type: text("type").notNull(),
  description: text("description"),
  paymentId: integer("payment_id"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const insertPatientAccountTransactionSchema = createInsertSchema(patientAccountTransactionsTable).omit({ id: true, uuid: true, createdAt: true });
export type InsertPatientAccountTransaction = z.infer<typeof insertPatientAccountTransactionSchema>;
export type PatientAccountTransaction = typeof patientAccountTransactionsTable.$inferSelect;
