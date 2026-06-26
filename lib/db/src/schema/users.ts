import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role", { enum: ["admin", "staff"] }).notNull().default("staff"),
  staffId: integer("staff_id"),
  permissions: text("permissions").notNull().default("[]"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

export const ALL_PERMISSIONS = [
  "dashboard",
  "patients",
  "appointments",
  "payments",
  "services",
  "laser",
  "staff",
  "commissions",
  "discounts",
  "inventory",
  "accounting",
  "reports",
  "reminders",
  "backup",
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  dashboard: "داشبورد",
  patients: "مراجعین",
  appointments: "نوبت‌ها",
  payments: "صندوق",
  services: "خدمات",
  staff: "کارمندان",
  commissions: "کمیسیون",
  discounts: "تخفیفات",
  inventory: "انبار",
  laser: "لیزر",
  accounting: "حسابداری",
  reports: "گزارشات",
  reminders: "یادآوری‌ها",
  backup: "پشتیبان‌گیری",
};
