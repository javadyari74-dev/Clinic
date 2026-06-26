import { Router } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { signToken, requireAuth, requireAdmin } from "../lib/auth";

const router = Router();

router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ message: "نام کاربری و رمز عبور الزامی است" });
    return;
  }
  const normalizedUsername = String(username).toLowerCase();
  const user = await db.select().from(usersTable).where(eq(usersTable.username, normalizedUsername)).get();
  if (!user || !user.isActive) {
    res.status(401).json({ message: "نام کاربری یا رمز عبور اشتباه است" });
    return;
  }
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    res.status(401).json({ message: "نام کاربری یا رمز عبور اشتباه است" });
    return;
  }
  const permissions = JSON.parse(user.permissions ?? "[]");
  const token = signToken({
    sub: user.id,
    username: user.username,
    role: user.role as "admin" | "staff" | "laser_operator",
    permissions,
  });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role, permissions } });
});

router.get("/auth/me", requireAuth, async (req, res) => {
  const user = await db.select().from(usersTable).where(eq(usersTable.id, req.jwtUser!.sub)).get();
  if (!user) { res.status(404).json({ message: "کاربر یافت نشد" }); return; }
  res.json({ id: user.id, username: user.username, role: user.role, permissions: JSON.parse(user.permissions ?? "[]"), staffId: user.staffId, isActive: user.isActive });
});

router.get("/users", requireAdmin, async (_req, res) => {
  const users = await db.select({
    id: usersTable.id,
    username: usersTable.username,
    role: usersTable.role,
    staffId: usersTable.staffId,
    permissions: usersTable.permissions,
    isActive: usersTable.isActive,
    createdAt: usersTable.createdAt,
  }).from(usersTable).all();
  res.json(users.map(u => ({ ...u, permissions: JSON.parse(u.permissions ?? "[]") })));
});

router.post("/users", requireAdmin, async (req, res) => {
  const { username, password, role, staffId, permissions, isActive } = req.body ?? {};
  if (!username || !password) {
    res.status(400).json({ message: "نام کاربری و رمز عبور الزامی است" });
    return;
  }
  const normalizedUsername = String(username).toLowerCase();
  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, normalizedUsername)).get();
  if (existing) { res.status(409).json({ message: "این نام کاربری قبلاً استفاده شده است" }); return; }
  const hashed = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({
    username: normalizedUsername,
    password: hashed,
    role: role ?? "staff",
    staffId: staffId ?? null,
    permissions: JSON.stringify(permissions ?? []),
    isActive: isActive ?? true,
  }).returning();
  res.status(201).json({ id: user.id, username: user.username, role: user.role, permissions: JSON.parse(user.permissions ?? "[]"), isActive: user.isActive });
});

router.put("/users/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { username, password, role, staffId, permissions, isActive } = req.body ?? {};
  const existing = await db.select().from(usersTable).where(eq(usersTable.id, id)).get();
  if (!existing) { res.status(404).json({ message: "کاربر یافت نشد" }); return; }
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (username !== undefined) updates.username = String(username).toLowerCase();
  if (role !== undefined) updates.role = role;
  if (staffId !== undefined) updates.staffId = staffId;
  if (permissions !== undefined) updates.permissions = JSON.stringify(permissions);
  if (isActive !== undefined) updates.isActive = isActive;
  if (password) updates.password = await bcrypt.hash(password, 10);
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  res.json({ id: user.id, username: user.username, role: user.role, permissions: JSON.parse(user.permissions ?? "[]"), isActive: user.isActive });
});

router.delete("/users/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (req.jwtUser!.sub === id) { res.status(400).json({ message: "نمی‌توانید حساب خود را حذف کنید" }); return; }
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.status(204).end();
});

export default router;
