import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const laserServicesTable = sqliteTable("laser_services", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").unique(),
  name: text("name").notNull(),
  genderCategory: text("gender_category", { enum: ["male", "female"] }).notNull(),
  price: integer("price").notNull(),
  commissionRate: integer("commission_rate").notNull().default(0),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export type LaserService = typeof laserServicesTable.$inferSelect;
