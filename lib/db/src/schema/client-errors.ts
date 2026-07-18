import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clientErrorsTable = sqliteTable("client_errors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  message: text("message").notNull(),
  stack: text("stack"),
  componentStack: text("component_stack"),
  url: text("url"),
  userAgent: text("user_agent"),
  // Client-supplied timestamp (ISO string) of when the crash happened.
  occurredAt: text("occurred_at"),
  // Server receive time (unix seconds), used for ordering.
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const insertClientErrorSchema = createInsertSchema(clientErrorsTable).omit({ id: true, createdAt: true });
export type InsertClientError = z.infer<typeof insertClientErrorSchema>;
export type ClientError = typeof clientErrorsTable.$inferSelect;
