import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const servicesTable = sqliteTable("services", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  serviceCode: text("service_code").unique(),
  name: text("name").notNull(),
  category: text("category"),
  durationMinutes: integer("duration_minutes"),
  price: integer("price").notNull(),
  doctorFee: integer("doctor_fee").default(0),
  materialCost: integer("material_cost").default(0),
  otherCost: integer("other_cost").default(0),
  unitCount: integer("unit_count").notNull().default(1),
  unitLabel: text("unit_label"),
  priceMode: text("price_mode").notNull().default("total"),
  doctorFeeMode: text("doctor_fee_mode").notNull().default("total"),
  materialCostMode: text("material_cost_mode").notNull().default("total"),
  otherCostMode: text("other_cost_mode").notNull().default("total"),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const insertServiceSchema = createInsertSchema(servicesTable).omit({ id: true });
export type InsertService = z.infer<typeof insertServiceSchema>;
export type Service = typeof servicesTable.$inferSelect;
