import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "node:crypto";

export const remindersTable = sqliteTable("reminders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  uuid: text("uuid").notNull().unique().$defaultFn(() => randomUUID()),
  title: text("title").notNull(),
  description: text("description"),
  type: text("type").notNull().default("custom"),
  patientId: integer("patient_id"),
  dueAt: integer("due_at").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const insertReminderSchema = createInsertSchema(remindersTable).omit({ id: true, uuid: true, createdAt: true });
export type InsertReminder = z.infer<typeof insertReminderSchema>;
export type Reminder = typeof remindersTable.$inferSelect;
