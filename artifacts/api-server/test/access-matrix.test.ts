import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

// ماتریس دسترسی سمت سرور (routes/index.ts): برای هر دسترسی، همهٔ درخواست‌های GET که
// صفحهٔ آن (و اجزای مشترک صفحه) هنگام بارگذاری می‌زند باید ۲۰۰ بدهد، و بخش‌های
// دیگر ۴۰۳. فهرست‌ها از روی فراخوان‌های فرانت‌اند (artifacts/beauty-clinic/src) تهیه شده‌اند.

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
let P = 0; // شناسهٔ یک مراجع نمونه
let R = 0; // شناسهٔ یک گیرندهٔ کمیسیون نمونه

const PERMS = [
  "dashboard", "patients", "appointments", "payments", "services", "laser", "staff",
  "commissions", "discounts", "inventory", "accounting", "reports", "reminders", "sms",
  "surveys", "loyalty", "backup",
] as const;
type Perm = (typeof PERMS)[number];

async function createUser(username: string, role: "admin" | "staff" | "laser_operator", permissions: string[]) {
  const [u] = await dbModule.db
    .insert(dbModule.usersTable)
    .values({ username, password: "x", role, permissions: JSON.stringify(permissions) })
    .returning();
  tokens[username] = auth.signToken({ sub: u.id, username, role, permissions });
}

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "access-matrix-test-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-clinic.db");
  dbModule = await import("@workspace/db");
  await dbModule.runMigrations(MIGRATIONS_DIR);
  auth = await import("../src/lib/auth");
  const { default: router } = await import("../src/routes");

  await createUser("admin", "admin", []);
  // اپراتور لیزر با دسترسی‌های ذخیره‌شدهٔ گمراه‌کننده — نقش تعیین‌کننده است
  await createUser("laserop", "laser_operator", ["patients", "payments", "backup"]);
  for (const p of PERMS) await createUser(`u_${p}`, "staff", [p]);

  const [patient] = await dbModule.db
    .insert(dbModule.patientsTable)
    .values({ name: "نمونه", phone: "09120000001", fileNumber: "M-1" })
    .returning();
  P = patient.id;
  const [rcp] = await dbModule.db.insert(dbModule.commissionRecipientsTable).values({ name: "معرف" }).returning();
  R = rcp.id;

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

async function call(user: string, method: string, p: string, body?: unknown) {
  const headers: Record<string, string> = { authorization: `Bearer ${tokens[user]}` };
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  await res.text();
  return res.status;
}

const now = Date.now();
const RANGE = `from=${now - 30 * 86_400_000}&to=${now}`;

// درخواست‌های GET هنگام بارگذاری هر صفحه (+ داده‌هایی که پنجره‌های همان صفحه لازم دارند)
const PAGE_GETS: Record<Perm, () => string[]> = {
  dashboard: () => ["/dashboard/summary", "/dashboard/revenue-chart", "/activity", "/appointments", "/payments", "/reminders", "/patients/upcoming-birthdays"],
  patients: () => [
    "/patients", `/patients/${P}`, `/patients/${P}/appointments`, `/patients/${P}/notes`, `/patients/${P}/loyalty`,
    `/patients/${P}/account-transactions`, "/appointments", "/commission-recipients", "/reminders", "/services", "/staff",
  ],
  appointments: () => ["/appointments", "/patients", "/services", "/staff", "/waiting-list", `/patients/${P}/appointments`, `/patients/${P}/notes`],
  payments: () => [
    "/payments", "/appointments", "/commission-recipients", "/commissions", "/discounts", "/patients", `/patients/${P}`,
    `/patients/${P}/account-transactions`, `/patients/${P}/loyalty`, "/reminders", "/staff", "/services",
  ],
  services: () => ["/services"],
  laser: () => ["/laser/clients", "/laser/services", "/laser/settings", "/laser/appointments", "/laser/payments", "/laser/operator", "/laser/reminders"],
  staff: () => ["/staff", `/accounting/revenue-range?${RANGE}`],
  commissions: () => ["/commissions", "/commission-recipients", "/staff", `/commission-recipients/${R}/referrals`],
  discounts: () => ["/discounts"],
  inventory: () => ["/inventory"],
  accounting: () => [`/accounting/summary?${RANGE}`, `/accounting/by-service?${RANGE}`, `/accounting/expenses?${RANGE}`],
  reports: () => ["/reports/summary", "/dashboard/revenue-chart"],
  reminders: () => ["/reminders", "/patients", "/patients/upcoming-birthdays"],
  sms: () => ["/sms/settings", "/sms/templates", "/sms/patterns", "/sms/logs", "/patients"],
  surveys: () => ["/surveys", "/surveys/stats"],
  loyalty: () => ["/loyalty/settings", "/loyalty/overview", "/loyalty/members"],
  backup: () => ["/backup/settings", "/backup/logs"],
};

const LOOKUP: Perm[] = ["patients", "appointments", "payments", "reminders", "sms"];
// مسیر → دسترسی‌هایی که اجازه دارند (بقیه ۴۰۳). [] یعنی فقط مدیر.
const MATRIX: Array<[() => string, Perm[]]> = [
  [() => "/dashboard/summary", ["dashboard"]],
  [() => "/activity", ["dashboard"]],
  [() => "/dashboard/revenue-chart", ["dashboard", "reports"]],
  [() => "/patients", LOOKUP],
  [() => `/patients/${P}`, LOOKUP],
  [() => `/patients/${P}/notes`, LOOKUP],
  [() => `/patients/${P}/loyalty`, ["payments", "loyalty", "patients"]],
  [() => `/patients/${P}/account-transactions`, ["payments", "patients"]],
  [() => "/patients/upcoming-birthdays", ["dashboard", "reminders", "patients"]],
  [() => "/patients/export/excel", []],
  [() => "/appointments", ["appointments", "dashboard", "payments", "patients"]],
  [() => "/waiting-list", ["appointments"]],
  [() => "/payments", ["payments", "dashboard"]],
  [() => "/services", ["services", ...LOOKUP]],
  [() => "/staff", ["staff", "commissions", ...LOOKUP]],
  [() => "/discounts", ["discounts", "payments"]],
  [() => "/commission-recipients", ["commissions", "payments", "patients"]],
  [() => `/commission-recipients/${R}/referrals`, ["commissions"]],
  [() => "/commissions", ["commissions", "payments"]],
  [() => "/inventory", ["inventory"]],
  [() => "/reminders", ["reminders", "dashboard", "patients", "payments"]],
  [() => "/surveys", ["surveys"]],
  [() => "/loyalty/settings", ["loyalty"]],
  [() => "/sms/templates", ["sms"]],
  [() => "/laser/clients", ["laser"]],
  [() => `/accounting/summary?${RANGE}`, ["accounting"]],
  [() => `/accounting/revenue-range?${RANGE}`, ["accounting", "staff"]],
  [() => "/reports/summary", ["reports"]],
  [() => "/backup/settings", ["backup"]],
  [() => "/backup/logs", ["backup"]],
  [() => "/backup/download", []],
  [() => "/users", []],
];

describe("each permission can load its own page", () => {
  for (const perm of PERMS) {
    it(`${perm}: every GET its page makes returns 200`, async () => {
      const results: Record<string, number> = {};
      for (const p of PAGE_GETS[perm]()) results[p] = await call(`u_${perm}`, "GET", p);
      const bad = Object.entries(results).filter(([, s]) => s !== 200);
      expect(bad).toEqual([]);
    });
  }

  it("admin can load every page", async () => {
    for (const perm of PERMS) {
      for (const p of PAGE_GETS[perm]()) expect([p, await call("admin", "GET", p)]).toEqual([p, 200]);
    }
  });
});

describe("GET access matrix", () => {
  for (const perm of PERMS) {
    it(`${perm}: allowed vs forbidden`, async () => {
      const wrong: string[] = [];
      for (const [pathFn, allowed] of MATRIX) {
        const p = pathFn();
        const status = await call(`u_${perm}`, "GET", p);
        const expectAllowed = allowed.includes(perm);
        if (expectAllowed ? status === 403 || status === 401 : status !== 403) wrong.push(`${p} → ${status}`);
      }
      expect(wrong).toEqual([]);
    });
  }

  it("laser operator only reaches the laser section, whatever its stored permissions say", async () => {
    const wrong: string[] = [];
    for (const [pathFn, allowed] of MATRIX) {
      const p = pathFn();
      const status = await call("laserop", "GET", p);
      const ok = allowed.includes("laser") ? status === 200 : status === 403;
      if (!ok) wrong.push(`${p} → ${status}`);
    }
    expect(wrong).toEqual([]);
    // دور زدن با حروف بزرگ یا اسلش اضافه ممکن نیست
    expect(await call("laserop", "GET", "/PATIENTS")).toBe(403);
    expect(await call("laserop", "GET", `/Patients/${P}/LOYALTY`)).toBe(403);
    expect(await call("laserop", "GET", "/patients/")).toBe(403);
  });
});

describe("write rules", () => {
  it("payments user can top up a wallet and record commissions but not edit other sections", async () => {
    expect(await call("u_payments", "POST", `/patients/${P}/account-transactions`, { amount: 1000, type: "deposit" })).not.toBe(403);
    expect(await call("u_payments", "POST", "/commissions", {})).not.toBe(403);
    expect(await call("u_payments", "POST", "/reminders", {})).not.toBe(403);
    expect(await call("u_payments", "POST", "/services", { name: "x", price: 1 })).toBe(403);
    expect(await call("u_payments", "PUT", `/patients/${P}`, { name: "x" })).toBe(403);
    expect(await call("u_payments", "DELETE", "/discounts/1")).toBe(403);
    expect(await call("u_payments", "POST", "/staff", { name: "x" })).toBe(403);
  });

  it("deleting a payment is admin-only", async () => {
    expect(await call("u_payments", "DELETE", "/payments/999")).toBe(403);
    expect(await call("u_payments", "DELETE", "/Payments/999")).toBe(403);
    expect(await call("admin", "DELETE", "/payments/999")).not.toBe(403);
  });

  it("reminders, appointments and patients keep writes to their owners", async () => {
    expect(await call("u_dashboard", "POST", "/reminders", {})).toBe(403);
    expect(await call("u_dashboard", "PUT", "/appointments/1", {})).toBe(403);
    expect(await call("u_payments", "DELETE", "/appointments/1")).toBe(403);
    expect(await call("u_patients", "POST", "/patients", {})).not.toBe(403);
    expect(await call("u_appointments", "POST", "/patients", {})).toBe(403);
    expect(await call("u_patients", "DELETE", "/patient-notes/1")).not.toBe(403);
    expect(await call("u_appointments", "DELETE", "/patient-notes/1")).toBe(403);
  });

  it("backup: only admin can download, change folders or export patients", async () => {
    expect(await call("u_backup", "POST", "/backup/run")).not.toBe(403);
    expect(await call("u_backup", "GET", "/backup/download")).toBe(403);
    expect(await call("u_backup", "PUT", "/backup/settings", { backupDir: "/tmp/x" })).toBe(403);
    expect(await call("u_backup", "PUT", "/backup/mirror", { mirrorDir: "" })).toBe(403);
    expect(await call("u_patients", "GET", "/patients/export/excel")).toBe(403);
    expect(await call("admin", "GET", "/patients/export/excel")).toBe(200);
    expect(await call("admin", "GET", "/backup/download")).toBe(200);
  });

  it("laser deletes are admin-only", async () => {
    const { db, laserClientsTable, laserServicesTable, laserAppointmentsTable } = dbModule;
    const [c] = await db.insert(laserClientsTable).values({ fileNumber: "LZ-1", name: "x", phone: "1", gender: "female" }).returning();
    const [s] = await db.insert(laserServicesTable).values({ name: "y", genderCategory: "female", price: 1 }).returning();
    const [a] = await db.insert(laserAppointmentsTable).values({ clientId: c.id, serviceId: s.id, scheduledAt: new Date() }).returning();
    for (const p of [`/laser/appointments/${a.id}`, `/laser/clients/${c.id}`, `/laser/services/${s.id}`]) {
      expect(await call("laserop", "DELETE", p)).toBe(403);
      expect(await call("u_laser", "DELETE", p)).toBe(403);
    }
    for (const p of [`/laser/appointments/${a.id}`, `/laser/clients/${c.id}`, `/laser/services/${s.id}`]) {
      expect(await call("admin", "DELETE", p)).toBe(204);
    }
  });
});
