import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const discountsTable = sqliteTable("discounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  type: text("type").notNull(),
  value: integer("value").notNull(),
  minAmount: integer("min_amount"),
  usageLimit: integer("usage_limit"),
  usageCount: integer("usage_count").notNull().default(0),
  startDate: text("start_date"),
  endDate: text("end_date"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  description: text("description"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const insertDiscountSchema = createInsertSchema(discountsTable).omit({ id: true, createdAt: true, usageCount: true });
export type InsertDiscount = z.infer<typeof insertDiscountSchema>;
export type Discount = typeof discountsTable.$inferSelect;
