import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "./logger";

export async function seedAdminUser() {
  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, "admin"))
    .get();

  if (existing) return;

  const hashed = await bcrypt.hash("admin123", 10);
  await db.insert(usersTable).values({
    username: "admin",
    password: hashed,
    role: "admin",
    permissions: "[]",
    isActive: true,
  });

  logger.info("Default admin user created (username: admin, password: admin123)");
}
