import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const laserClientsTable = sqliteTable("laser_clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fileNumber: text("file_number").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  gender: text("gender", { enum: ["male", "female"] }).notNull(),
  email: text("email"),
  birthdate: text("birthdate"),
  skinType: text("skin_type"),
  hairColor: text("hair_color"),
  medicalHistory: text("medical_history"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export type LaserClient = typeof laserClientsTable.$inferSelect;
