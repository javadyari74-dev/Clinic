import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

// گزارش سود و زیان در بازهٔ دلخواه و نمودار روزانه، روی یک SQLite موقت.

vi.mock("../src/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../lib/db/migrations");

const DAY = 86400;
const HOUR = 3600;
const TEHRAN = 210; // UTC+3:30, دقیقه
// نیمه‌شب ۱ مهر ۱۴۰۵ به وقت تهران (۲۰۲۶-۰۹-۲۳)
const T0 = Date.UTC(2026, 8, 23) / 1000 - TEHRAN * 60;

let server: http.Server;
let base: string;

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "accounting-test-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-clinic.db");
  const dbm = await import("@workspace/db");
  await dbm.runMigrations(MIGRATIONS_DIR);
  const { db } = dbm;

  const [patient] = await db.insert(dbm.patientsTable).values({ name: "الف", phone: "1", fileNumber: "F1" }).returning();
  const [service] = await db.insert(dbm.servicesTable).values({
    name: "لیزر", price: 1_000_000,
    doctorFee: 200_000, doctorFeeMode: "total",
    materialCost: 10_000, materialCostMode: "per_unit", unitCount: 3,
  }).returning();
  const [appt] = await db.insert(dbm.appointmentsTable).values({
    patientId: patient.id, serviceId: service.id, scheduledAt: (T0 + DAY) * 1000, unitsUsed: 5,
  }).returning();
  await db.insert(dbm.paymentsTable).values([
    // بیعانه: روز اول، ساعت ۱ بامداد تهران
    { appointmentId: appt.id, originalAmount: 100_000, amount: 100_000, method: "cash", notes: "بیعانه", paidAt: T0 + HOUR },
    // پرداخت نهایی: روز دوم، ساعت ۱ بامداد تهران (در UTC هنوز روز اول است)
    { appointmentId: appt.id, originalAmount: 900_000, amount: 900_000, method: "card", paidAt: T0 + DAY + HOUR },
    // خارج از بازه
    { appointmentId: appt.id, originalAmount: 5_000_000, amount: 5_000_000, method: "card", paidAt: T0 + 10 * DAY },
  ]);
  // هزینهٔ ثابت با تاریخ «نیمه‌شب محلی» روز اول، همان‌طور که فرم ثبت هزینه ذخیره می‌کند
  await db.insert(dbm.expensesTable).values({ category: "rent", amount: 300_000, description: "اجاره", date: T0 });
  await db.insert(dbm.commissionsTable).values({
    recipientType: "staff", recipientId: 1, appointmentId: appt.id, amount: 50_000, createdAt: T0 + DAY + 2 * HOUR,
  });

  const { default: accountingRouter } = await import("../src/routes/accounting");
  const app = express();
  app.use(express.json());
  app.use(accountingRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function get(p: string) {
  const res = await fetch(`${base}${p}`);
  return { status: res.status, json: await res.json() };
}

const range = `from=${T0}&to=${T0 + 3 * DAY}`;

describe("accounting custom range", () => {
  it("summarises revenue, costs and net profit inside the range only", async () => {
    const { status, json } = await get(`/accounting/summary?${range}`);
    expect(status).toBe(200);
    expect(json).toMatchObject({
      revenue: 1_000_000,
      serviceCosts: 250_000, // 200k + 10k × 5 واحد
      expenses: 300_000,
      commissions: 50_000,
      totalCosts: 600_000,
      netProfit: 400_000,
    });
  });

  it("applies the same range to the per-service breakdown", async () => {
    const { json } = await get(`/accounting/by-service?${range}`);
    expect(json).toHaveLength(1);
    expect(json[0]).toMatchObject({ revenue: 1_000_000, totalServiceCost: 250_000, commissions: 50_000, profit: 700_000 });
  });

  it("rejects an invalid range", async () => {
    expect((await get(`/accounting/summary?from=${T0}&to=${T0}`)).status).toBe(400);
    expect((await get(`/accounting/summary?from=abc&to=${T0}`)).status).toBe(400);
    expect((await get(`/accounting/chart?${range}&tz=99999`)).status).toBe(400);
  });
});

describe("accounting chart", () => {
  it("buckets by the user's local day and includes every cost in profit", async () => {
    const { status, json } = await get(`/accounting/chart?${range}&tz=${TEHRAN}`);
    expect(status).toBe(200);
    expect(json).toEqual([
      { date: "2026-09-23", revenue: 100_000, serviceCosts: 0, expenses: 300_000, commissions: 0, totalCosts: 300_000, profit: -200_000 },
      { date: "2026-09-24", revenue: 900_000, serviceCosts: 250_000, expenses: 0, commissions: 50_000, totalCosts: 300_000, profit: 600_000 },
    ]);
  });

  it("daily profits add up to the summary's net profit", async () => {
    const chart = (await get(`/accounting/chart?${range}&tz=${TEHRAN}`)).json as Array<{ profit: number; revenue: number }>;
    const summary = (await get(`/accounting/summary?${range}`)).json;
    expect(chart.reduce((s, p) => s + p.profit, 0)).toBe(summary.netProfit);
    expect(chart.reduce((s, p) => s + p.revenue, 0)).toBe(summary.revenue);
  });
});
