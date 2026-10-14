import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { randomUUID } from "node:crypto";

export const activityLogTable = sqliteTable("activity_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  uuid: text("uuid").notNull().unique().$defaultFn(() => randomUUID()),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  description: text("description").notNull(),
  // کاربری که تغییر را انجام داده (رکوردهای قدیمی‌تر: null)
  username: text("username"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const insertActivityLogSchema = createInsertSchema(activityLogTable).omit({ id: true, uuid: true, createdAt: true, username: true });
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogTable.$inferSelect;
