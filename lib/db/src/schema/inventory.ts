import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const inventoryTable = sqliteTable("inventory", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category"),
  unit: text("unit"),
  quantity: integer("quantity").notNull().default(0),
  minQuantity: integer("min_quantity").notNull().default(0),
  costPrice: integer("cost_price"),
  salePrice: integer("sale_price"),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const insertInventorySchema = createInsertSchema(inventoryTable).omit({ id: true, updatedAt: true });
export type InsertInventory = z.infer<typeof insertInventorySchema>;
export type Inventory = typeof inventoryTable.$inferSelect;
