import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const commissionRecipientsTable = sqliteTable("commission_recipients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone"),
  description: text("description"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const insertCommissionRecipientSchema = createInsertSchema(commissionRecipientsTable).omit({ id: true, createdAt: true });
export type InsertCommissionRecipient = z.infer<typeof insertCommissionRecipientSchema>;
export type CommissionRecipient = typeof commissionRecipientsTable.$inferSelect;

export const commissionsTable = sqliteTable("commissions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recipientType: text("recipient_type").notNull(),
  recipientId: integer("recipient_id").notNull(),
  appointmentId: integer("appointment_id"),
  description: text("description"),
  amount: integer("amount").notNull(),
  rate: integer("rate"),
  status: text("status").notNull().default("pending"),
  isPaid: integer("is_paid", { mode: "boolean" }).notNull().default(false),
  paidAt: integer("paid_at"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const insertCommissionSchema = createInsertSchema(commissionsTable).omit({ id: true, createdAt: true, isPaid: true, paidAt: true });
export type InsertCommission = z.infer<typeof insertCommissionSchema>;
export type Commission = typeof commissionsTable.$inferSelect;
