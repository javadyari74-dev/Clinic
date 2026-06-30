import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.JWT_SECRET ?? "clinic-secret-key-change-in-production";
const JWT_EXPIRES = "7d";

export interface JwtPayload {
  sub: number;
  username: string;
  role: "admin" | "staff" | "laser_operator";
  permissions: string[];
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as unknown as JwtPayload;
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

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.jwtUser?.role !== "admin") {
      res.status(403).json({ message: "فقط مدیران دسترسی دارند" });
      return;
    }
    next();
  });
}
