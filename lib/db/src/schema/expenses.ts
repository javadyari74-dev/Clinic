import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const expensesTable = sqliteTable("expenses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  category: text("category").notNull(),
  amount: integer("amount").notNull(),
  description: text("description").notNull(),
  date: integer("date").notNull(),
  serviceId: integer("service_id"),
  staffId: integer("staff_id"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const insertExpenseSchema = createInsertSchema(expensesTable).omit({ id: true, createdAt: true });
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expensesTable.$inferSelect;
