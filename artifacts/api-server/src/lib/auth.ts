import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

// راز امضای توکن — در محیط production باید حتماً تنظیم شده باشد
const JWT_SECRET = process.env.JWT_SECRET ?? process.env.SESSION_SECRET ?? "";
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET (or SESSION_SECRET) must be set in production");
  }
  console.warn("[auth] JWT_SECRET/SESSION_SECRET not set — using insecure dev-only fallback");
}
const EFFECTIVE_SECRET = JWT_SECRET || "dev-only-insecure-secret";
const JWT_EXPIRES = "7d";

export interface JwtPayload {
  sub: number;
  username: string;
  role: "admin" | "staff" | "laser_operator";
  permissions: string[];
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, EFFECTIVE_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, EFFECTIVE_SECRET) as unknown as JwtPayload;
}

declare global {
  namespace Express {
    interface Request {
      jwtUser?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ message: "احراز هویت الزامی است" });
    return;
  }
  try {
    req.jwtUser = verifyToken(header.slice(7));
    next();
  } catch {
    res.status(401).json({ message: "توکن نامعتبر یا منقضی شده است" });
  }
}

// نقش و دسترسی‌ها از پایگاه داده خوانده می‌شود، نه از توکن؛ تا غیرفعال‌سازی کاربر
// یا تغییر دسترسی‌هایش فوراً اعمال شود (توکن تا ۷ روز معتبر می‌ماند).
async function loadActiveUser(id: number) {
  const user = await db
    .select({ role: usersTable.role, permissions: usersTable.permissions, isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .get();
  if (!user || !user.isActive) return null;
  let permissions: string[] = [];
  try {
    const parsed = JSON.parse(user.permissions ?? "[]");
    if (Array.isArray(parsed)) permissions = parsed.map(String);
  } catch {
    /* دسترسی نامعتبر = بدون دسترسی */
  }
  return { role: user.role, permissions };
}

function withAuth(
  req: Request,
  res: Response,
  next: NextFunction,
  allowed: (user: { role: string; permissions: string[] }) => boolean,
  deniedMessage: string,
): void {
  const check = () => {
    loadActiveUser(req.jwtUser!.sub)
      .then((user) => {
        if (!user) {
          res.status(401).json({ message: "حساب کاربری غیرفعال یا حذف شده است" });
          return;
        }
        if (!allowed(user)) {
          res.status(403).json({ message: deniedMessage });
          return;
        }
        next();
      })
      .catch(next);
  };
  if (req.jwtUser) check();
  else requireAuth(req, res, check);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  withAuth(req, res, next, (u) => u.role === "admin", "فقط مدیران دسترسی دارند");
}

// همان قاعدهٔ hasPermission در فرانت‌اند (hooks/use-auth.tsx): مدیر همه‌چیز،
// اپراتور لیزر فقط «laser»، بقیه طبق فهرست دسترسی‌هایشان.
function hasPermission(user: { role: string; permissions: string[] }, perm: string): boolean {
  if (user.role === "admin") return true;
  if (user.role === "laser_operator") return perm === "laser";
  return user.permissions.includes(perm);
}

// کاربر باید دست‌کم یکی از دسترسی‌های ذکرشده را داشته باشد.
export function requirePermission(...perms: string[]): RequestHandler {
  return (req, res, next) => {
    withAuth(
      req,
      res,
      next,
      (u) => perms.some((p) => hasPermission(u, p)),
      "شما به این بخش دسترسی ندارید",
    );
  };
}
