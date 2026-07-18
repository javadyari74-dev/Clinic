import { sqliteTable, integer } from "drizzle-orm/sqlite-core";

export const laserSettingsTable = sqliteTable("laser_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  commissionRate: integer("commission_rate").notNull().default(0),
});

export type LaserSettings = typeof laserSettingsTable.$inferSelect;
