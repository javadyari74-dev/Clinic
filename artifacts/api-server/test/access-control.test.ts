import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

// کنترل دسترسی سمت سرور (routes/index.ts) و اتمیک بودن بازیابی پشتیبان،
// روی یک پایگاه دادهٔ SQLite موقت.

vi.mock("../src/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../lib/db/migrations");

let dbModule: typeof import("@workspace/db");
let auth: typeof import("../src/lib/auth");
let server: http.Server;
let base: string;
const tokens: Record<string, string> = {};

async function createUser(
  username: string,
  role: "admin" | "staff" | "laser_operator",
  permissions: string[],
  isActive = true,
) {
  const [u] = await dbModule.db
    .insert(dbModule.usersTable)
    .values({ username, password: "x", role, permissions: JSON.stringify(permissions), isActive })
    .returning();
  // توکن عمداً دسترسی کامل ادعا می‌کند تا ثابت شود سرور به پایگاه داده تکیه می‌کند نه توکن
  tokens[username] = auth.signToken({ sub: u.id, username, role, permissions: ["backup", "sms", "accounting"] });
  return u;
}

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "access-control-test-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-clinic.db");
  dbModule = await import("@workspace/db");
  await dbModule.runMigrations(MIGRATIONS_DIR);
  auth = await import("../src/lib/auth");
  const { default: router } = await import("../src/routes");

  await createUser("boss", "admin", []);
  await createUser("clerk", "staff", ["patients", "staff"]);
  await createUser("backupper", "staff", ["backup"]);
  await createUser("laser", "laser_operator", ["backup", "sms"]);
  await createUser("gone", "admin", [], false);

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api", router);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function call(user: string | null, method: string, p: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (user) headers.authorization = `Bearer ${tokens[user]}`;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  await res.text();
  return res.status;
}

describe("server-side route access", () => {
  it("requires a token", async () => {
    expect(await call(null, "GET", "/backup/settings")).toBe(401);
  });

  it("blocks a staff user without the permission from sensitive areas", async () => {
    expect(await call("clerk", "GET", "/backup/download")).toBe(403);
    expect(await call("clerk", "DELETE", "/reset")).toBe(403);
    expect(await call("clerk", "POST", "/backup/restore", { data: {} })).toBe(403);
    expect(await call("clerk", "GET", "/sms/settings")).toBe(403);
    expect(await call("clerk", "GET", "/accounting/summary")).toBe(403);
    expect(await call("clerk", "GET", "/reports/summary")).toBe(403);
    expect(await call("clerk", "GET", "/laser/clients")).toBe(403);
    expect(await call("clerk", "GET", "/users")).toBe(403);
    expect(await call("clerk", "POST", "/backup/run")).toBe(403);
    expect(await call("clerk", "PUT", "/backup/mirror", { mirrorDir: "/tmp/x" })).toBe(403);
  });

  it("cannot be bypassed with different letter case (Express routing is case-insensitive)", async () => {
    expect(await call("clerk", "GET", "/Backup/Download")).toBe(403);
    expect(await call("clerk", "DELETE", "/RESET")).toBe(403);
    expect(await call("clerk", "GET", "/SMS/settings")).toBe(403);
  });

  it("lets the staff page read revenue-range and leaves ungated areas open", async () => {
    expect(await call("clerk", "GET", "/accounting/revenue-range?from=1&to=2")).toBe(200);
    expect(await call("clerk", "GET", "/patients")).toBe(200);
  });

  it("keeps destructive backup operations admin-only even with the backup permission", async () => {
    expect(await call("backupper", "GET", "/backup/settings")).toBe(200);
    expect(await call("backupper", "DELETE", "/reset")).toBe(403);
    expect(await call("backupper", "POST", "/backup/restore", { data: {} })).toBe(403);
    expect(await call("backupper", "POST", "/backup/merge", { data: {} })).toBe(403);
  });

  it("limits a laser operator to the laser section regardless of stored permissions", async () => {
    expect(await call("laser", "GET", "/laser/clients")).toBe(200);
    expect(await call("laser", "GET", "/backup/settings")).toBe(403);
    expect(await call("laser", "GET", "/sms/settings")).toBe(403);
  });

  it("rejects a deactivated user even with a valid token", async () => {
    expect(await call("gone", "GET", "/backup/settings")).toBe(401);
  });

  it("lets an admin in", async () => {
    expect(await call("boss", "GET", "/backup/settings")).toBe(200);
    expect(await call("boss", "GET", "/users")).toBe(200);
  });

  it("rejects an invalid role and self-demotion", async () => {
    const boss = await dbModule.db.select().from(dbModule.usersTable).all();
    const bossId = boss.find((u) => u.username === "boss")!.id;
    expect(await call("boss", "POST", "/users", { username: "x1", password: "p", role: "root" })).toBe(400);
    expect(await call("boss", "PUT", `/users/${bossId}`, { role: "staff" })).toBe(400);
    expect(await call("boss", "PUT", `/users/${bossId}`, { isActive: false })).toBe(400);
  });
});

describe("POST /backup/restore", () => {
  it("rolls back completely when the backup file fails mid-way", async () => {
    await dbModule.db.insert(dbModule.patientsTable).values({ name: "بیمار فعلی", phone: "09120000000", fileNumber: "F-1" });

    // دو ردیف با شناسهٔ یکسان → خطای UNIQUE پس از پاک‌سازی داده‌ها
    const status = await call("boss", "POST", "/backup/restore", {
      data: {
        services: [],
        patients: [
          { id: 500, name: "الف", phone: "1", fileNumber: "R-1" },
          { id: 500, name: "ب", phone: "2", fileNumber: "R-2" },
        ],
      },
    });
    expect(status).toBe(500);

    const patients = await dbModule.db.select().from(dbModule.patientsTable).all();
    expect(patients.map((p) => p.name)).toEqual(["بیمار فعلی"]);
  });
});
