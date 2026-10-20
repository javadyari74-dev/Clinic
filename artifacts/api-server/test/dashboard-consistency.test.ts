import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";

// همخوانی اعداد داشبورد و حسابداری: روز/ماه شمسی به وقت تهران، نوبت‌های میلی‌ثانیه‌ای،
// هزینهٔ خدمت قسطی فقط یک‌بار، ستون هزینهٔ خالی، درآمد لیزر و پرداخت‌های بی‌نوبت.

vi.mock("../src/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../lib/db/migrations");

const DAY = 86400;
const HOUR = 3600;
const TEH = 12600; // UTC+3:30 به ثانیه
const tehranMidnight = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000 - TEH;

// ۱ شهریور، ۱ مهر و ۱ آبان ۱۴۰۵ به وقت تهران
const SHAHRIVAR1 = tehranMidnight(2026, 8, 23);
const MEHR1 = tehranMidnight(2026, 9, 23);
const ABAN1 = tehranMidnight(2026, 10, 23);
// «الان»: ۱۷ مهر ۱۴۰۵ ساعت ۱۰ صبح تهران
const TODAY = tehranMidnight(2026, 10, 9);
const NOW_MS = (TODAY + 10 * HOUR) * 1000;

let server: http.Server;
let base: string;

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-consistency-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-clinic.db");
  const dbm = await import("@workspace/db");
  await dbm.runMigrations(MIGRATIONS_DIR);
  const { db } = dbm;

  const [patient] = await db.insert(dbm.patientsTable).values({ name: "ب", phone: "2", fileNumber: "F2" }).returning();
  // خدمت قسطی؛ هزینهٔ مواد و سایر خالی (NULL)
  const [svcInst] = await db.insert(dbm.servicesTable).values({
    name: "قسطی", price: 2_000_000, doctorFee: 300_000, doctorFeeMode: "total", materialCost: null, otherCost: null,
  }).returning();
  // هزینهٔ پزشک خالی، مواد به‌ازای واحد (۲ واحد پیش‌فرض)
  const [svcNull] = await db.insert(dbm.servicesTable).values({
    name: "واحدی", price: 500_000, doctorFee: null, materialCost: 50_000, materialCostMode: "per_unit", otherCost: null, unitCount: 2,
  }).returning();

  const appt = (serviceId: number, scheduledAt: number, status: string) =>
    db.insert(dbm.appointmentsTable).values({ patientId: patient.id, serviceId, scheduledAt, status }).returning().then(r => r[0]);

  const apptInst = await appt(svcInst.id, (SHAHRIVAR1 + 4 * DAY) * 1000, "completed");
  const apptNull = await appt(svcNull.id, (MEHR1 + 3 * DAY) * 1000, "completed");
  await appt(svcNull.id, NOW_MS, "scheduled");                               // امروز
  await appt(svcNull.id, (TODAY + HOUR) * 1000, "cancelled");                // امروز ۱ بامداد تهران (در UTC دیروز)
  await appt(svcNull.id, (TODAY - HOUR) * 1000, "completed");                // دیروز ۲۳:۰۰ تهران
  await appt(svcNull.id, TODAY + 5 * HOUR, "scheduled");                     // ردیف قدیمی به ثانیه، امروز

  await db.insert(dbm.paymentsTable).values([
    // قسط اول در شهریور، قسط دوم در مهر
    { appointmentId: apptInst.id, originalAmount: 1_000_000, amount: 1_000_000, method: "cash", paidAt: SHAHRIVAR1 + 5 * DAY },
    { appointmentId: apptInst.id, originalAmount: 1_000_000, amount: 1_000_000, method: "cash", paidAt: MEHR1 + 2 * DAY + HOUR },
    // امروز ۱ بامداد تهران
    { appointmentId: apptNull.id, originalAmount: 500_000, amount: 500_000, method: "card", paidAt: TODAY + HOUR },
    // پرداخت نوبتی که حذف شده
    { appointmentId: 99_999, originalAmount: 400_000, amount: 400_000, method: "cash", paidAt: MEHR1 + 10 * DAY + HOUR },
  ]);
  // پورسانت بدون نوبت
  await db.insert(dbm.commissionsTable).values({
    recipientType: "staff", recipientId: 1, appointmentId: null, amount: 30_000, createdAt: MEHR1 + 4 * DAY,
  });
  // لیزر
  // (SQL خام تا به ستون‌های تازه‌اضافه‌شدهٔ اسکیما وابسته نباشد؛ paid_at به ثانیه)
  await db.run(sql`
    INSERT INTO laser_payments (appointment_id, amount, commission_amount, method, paid_at)
    VALUES (1, 700000, 70000, 'cash', ${MEHR1 + 6 * DAY + HOUR})
  `);

  const { default: accountingRouter } = await import("../src/routes/accounting");
  const { default: dashboardRouter } = await import("../src/routes/dashboard");
  const app = express();
  app.use(express.json());
  app.use(accountingRouter);
  app.use(dashboardRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.useFakeTimers({ toFake: ["Date"], now: NOW_MS });
});

afterAll(async () => {
  vi.useRealTimers();
  await new Promise<void>((r) => server.close(() => r()));
});

async function get(p: string) {
  const res = await fetch(`${base}${p}`);
  return { status: res.status, json: await res.json() };
}

const q = (from: number, to: number) => `from=${from}&to=${to}`;

describe("Tehran / Shamsi period bounds", () => {
  it("computes the current Shamsi month and Tehran day", async () => {
    const { shamsiMonthBounds, tehranTodayBounds, shamsiYearBounds } = await import("../src/lib/tehran-period");
    expect(shamsiMonthBounds(NOW_MS)).toEqual({ start: MEHR1, end: ABAN1 });
    expect(shamsiMonthBounds(MEHR1 * 1000)).toEqual({ start: MEHR1, end: ABAN1 });
    expect(shamsiMonthBounds(MEHR1 * 1000 - 1)).toEqual({ start: SHAHRIVAR1, end: MEHR1 });
    expect(tehranTodayBounds(NOW_MS)).toEqual({ start: TODAY, end: TODAY + DAY });
    // ۰۰:۳۰ بامداد تهران هنوز در UTC روز قبل است
    expect(tehranTodayBounds((TODAY + 1800) * 1000)).toEqual({ start: TODAY, end: TODAY + DAY });
    expect(shamsiYearBounds(NOW_MS)).toEqual({ start: tehranMidnight(2026, 3, 21), end: tehranMidnight(2027, 3, 21) });
  });
});

describe("dashboard summary", () => {
  it("counts today's ms-stored appointments by the Tehran day and the Shamsi month", async () => {
    const { json } = await get("/dashboard/summary");
    expect(json).toMatchObject({
      appointmentsToday: 3,
      pendingAppointments: 2,
      completedThisMonth: 2,
      cancelledThisMonth: 1,
    });
  });

  it("monthly revenue equals the accounting revenue for this Shamsi month", async () => {
    const dash = (await get("/dashboard/summary")).json;
    const acc = (await get(`/accounting/summary?${q(MEHR1, ABAN1)}`)).json;
    expect(dash.monthlyRevenue).toBe(1_900_000);
    expect(dash.monthlyRevenue).toBe(acc.revenue);
    // period=month سمت سرور همان ماه شمسی است
    expect((await get("/accounting/summary?period=month")).json.revenue).toBe(acc.revenue);
  });

  it("buckets the revenue chart by Tehran day", async () => {
    const { json } = await get("/dashboard/revenue-chart");
    expect(json).toEqual([
      { date: "2026-09-25", revenue: 1_000_000 },
      { date: "2026-10-03", revenue: 400_000 },
      { date: "2026-10-09", revenue: 500_000 },
    ]);
  });
});

describe("accounting consistency", () => {
  it("charges an installment appointment's service cost once, in its first payment's month", async () => {
    const sep = (await get(`/accounting/summary?${q(SHAHRIVAR1, MEHR1)}`)).json;
    const oct = (await get(`/accounting/summary?${q(MEHR1, ABAN1)}`)).json;
    const both = (await get(`/accounting/summary?${q(SHAHRIVAR1, ABAN1)}`)).json;
    expect(sep.serviceCosts).toBe(300_000); // NULL مواد/سایر = صفر، نه حذف کل هزینه
    expect(oct.serviceCosts).toBe(100_000); // ۵۰٬۰۰۰ × ۲ واحد، هزینهٔ پزشک خالی
    expect(both.serviceCosts).toBe(400_000);
    expect(sep.netProfit + oct.netProfit).toBe(both.netProfit);

    const octBySvc = (await get(`/accounting/by-service?${q(MEHR1, ABAN1)}`)).json as Array<{ serviceName: string; totalServiceCost: number }>;
    expect(octBySvc.find(r => r.serviceName === "قسطی")?.totalServiceCost).toBe(0);
  });

  it("includes laser revenue and commissions in net profit", async () => {
    const oct = (await get(`/accounting/summary?${q(MEHR1, ABAN1)}`)).json;
    expect(oct).toMatchObject({
      revenue: 1_900_000,
      laserRevenue: 700_000,
      commissions: 30_000,
      laserCommissions: 70_000,
      serviceCosts: 100_000,
      totalCosts: 200_000,
      netProfit: 2_400_000,
    });
    const chart = (await get(`/accounting/chart?${q(MEHR1, ABAN1)}&tz=210`)).json as Array<{ profit: number; laserRevenue: number }>;
    expect(chart.reduce((s, p) => s + p.profit, 0)).toBe(oct.netProfit);
    expect(chart.reduce((s, p) => s + p.laserRevenue, 0)).toBe(700_000);
  });

  it("by-service totals equal the summary, with orphan payments and unlinked commissions", async () => {
    for (const [from, to] of [[MEHR1, ABAN1], [SHAHRIVAR1, ABAN1], [SHAHRIVAR1, MEHR1]]) {
      const summary = (await get(`/accounting/summary?${q(from, to)}`)).json;
      const rows = (await get(`/accounting/by-service?${q(from, to)}`)).json as Array<{
        serviceName: string; revenue: number; totalServiceCost: number; commissions: number;
      }>;
      expect(rows.reduce((s, r) => s + r.revenue, 0)).toBe(summary.revenue);
      expect(rows.reduce((s, r) => s + r.totalServiceCost, 0)).toBe(summary.serviceCosts);
      expect(rows.reduce((s, r) => s + r.commissions, 0)).toBe(summary.commissions);
    }
    const oct = (await get(`/accounting/by-service?${q(MEHR1, ABAN1)}`)).json as Array<{ serviceName: string; revenue: number; commissions: number }>;
    expect(oct.find(r => r.serviceName === "بدون نوبت / حذف‌شده")?.revenue).toBe(400_000);
    expect(oct.find(r => r.serviceName === "بدون خدمت")?.commissions).toBe(30_000);
  });
});
