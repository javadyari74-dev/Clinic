import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const staffTable = sqliteTable("staff", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  role: text("role"),
  phone: text("phone"),
  email: text("email"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

export const insertStaffSchema = createInsertSchema(staffTable).omit({ id: true });
export type InsertStaff = z.infer<typeof insertStaffSchema>;
export type Staff = typeof staffTable.$inferSelect;
