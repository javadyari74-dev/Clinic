import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

// سود = مبلغ واقعاً دریافتی − هزینهٔ خدمت در روز ارائهٔ خدمت؛ قیمت توافقی؛ تاریخچهٔ قیمت خدمات.
// مسیرهای واقعی روی SQLite موقت؛ پیامک mock شده است.

vi.mock("../src/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/lib/sms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/sms")>();
  return {
    ...actual,
    sendSms: vi.fn(async () => ({ ok: true })),
    fireCommissionSms: vi.fn(),
    firePaymentSms: vi.fn(),
    fireSurveySms: vi.fn(),
    fireAppointmentSms: vi.fn(),
  };
});

vi.mock("../src/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/auth")>();
  return { ...actual, requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next() };
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../lib/db/migrations");
const DAY = 86_400;

let dbm: typeof import("@workspace/db");
let server: http.Server;
let base: string;

async function call(method: string, p: string, body?: unknown) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

let fileSeq = 0;
async function patient(name: string) {
  const [p] = await dbm.db.insert(dbm.patientsTable)
    .values({ name, phone: "09121234567", fileNumber: `PP${++fileSeq}` }).returning();
  return p;
}
async function appointment(patientId: number, serviceId: number, scheduledAtMs = Date.now()) {
  const r = await call("POST", "/appointments", { patientId, serviceId, scheduledAt: scheduledAtMs });
  expect(r.status).toBe(201);
  return r.json;
}
/** سود یک بازهٔ کوچک که فقط پرداخت‌های همین تست را دارد */
async function summary(from: number, to: number) {
  return (await call("GET", `/accounting/summary?from=${from}&to=${to}`)).json;
}
const nowSec = () => Math.floor(Date.now() / 1000);

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "profit-pricing-test-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-clinic.db");
  dbm = await import("@workspace/db");
  await dbm.runMigrations(MIGRATIONS_DIR);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { jwtUser: unknown }).jwtUser = { sub: 1, role: "admin", username: "admin" }; next(); });
  for (const mod of ["payments", "appointments", "services", "accounting", "loyalty", "purchases"]) {
    const { default: r } = await import(`../src/routes/${mod}.ts`);
    app.use(r);
  }
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("profit is always amount received − service cost", () => {
  it("a negotiated price (3,000,000 → 2,800,000 with 1,800,000 cost) gives 1,000,000 profit and no debt", async () => {
    const svc = (await call("POST", "/services", { name: "فیلر توافقی", price: 3_000_000, doctorFee: 1_200_000, materialCost: 600_000 })).json;
    const p = await patient("چانه‌زن");
    const a = await appointment(p.id, svc.id);
    const from = nowSec() - 5;

    const pay = await call("POST", "/payments", {
      appointmentId: a.id, originalAmount: 3_000_000, amount: 2_800_000, method: "card", settleInFull: true,
    });
    expect(pay.status).toBe(201);
    expect(pay.json).toMatchObject({ amount: 2_800_000, discountAmount: 200_000, discountName: "تخفیف توافقی" });

    const appt = (await call("GET", `/appointments/${a.id}`)).json;
    expect(appt).toMatchObject({ status: "completed", price: 2_800_000, paidTotal: 2_800_000, remaining: 0 });

    const s = await summary(from, nowSec() + 5);
    expect(s.revenue).toBe(2_800_000);
    expect(s.serviceCosts).toBe(1_800_000);
    expect(s.netProfit).toBe(1_000_000);

    const byService = (await call("GET", `/accounting/by-service?from=${from}&to=${nowSec() + 5}`)).json;
    const row = byService.find((r: { serviceId: number }) => r.serviceId === svc.id);
    expect(row).toMatchObject({ revenue: 2_800_000 });
  });

  it("without the negotiated option the shortfall stays as debt", async () => {
    const svc = (await call("POST", "/services", { name: "بدهی", price: 3_000_000, doctorFee: 1_800_000 })).json;
    const a = await appointment((await patient("بدهکار")).id, svc.id);
    await call("POST", "/payments", { appointmentId: a.id, originalAmount: 3_000_000, amount: 2_800_000, method: "card" });
    expect((await call("GET", `/appointments/${a.id}`)).json).toMatchObject({ status: "completed", remaining: 200_000 });
  });

  it("the club's profit credit uses the same received amount", async () => {
    const settings = (await call("GET", "/loyalty/settings")).json;
    await call("PUT", "/loyalty/settings", { ...settings, enabled: true, profitRewardPercent: 5 });
    try {
      const svc = (await call("POST", "/services", { name: "باشگاه", price: 3_000_000, doctorFee: 1_800_000 })).json;
      const p = await patient("عضو");
      const a = await appointment(p.id, svc.id);
      await call("POST", "/payments", { appointmentId: a.id, originalAmount: 3_000_000, amount: 2_800_000, method: "card", settleInFull: true });
      const w = await dbm.db.select().from(dbm.patientsTable).all();
      expect(w.find((x) => x.id === p.id)?.accountBalance).toBe(50_000); // ۵٪ × ۱,۰۰۰,۰۰۰
    } finally {
      await call("PUT", "/loyalty/settings", { ...settings, enabled: false });
    }
  });
});

describe("service price history and cost on the day of service", () => {
  it("records every price/cost change with details and keeps past profit unchanged", async () => {
    const svc = (await call("POST", "/services", { name: "بوتاکس تاریخچه", price: 3_000_000, doctorFee: 1_000_000, materialCost: 500_000 })).json;
    const p = await patient("قدیمی");
    // نوبت دیروز با قیمت و هزینهٔ قدیم
    const oldAppt = await appointment(p.id, svc.id, Date.now() - DAY * 1000);
    const from = nowSec() - 5;
    const base0 = await summary(from, nowSec() + 3600);
    await call("POST", "/payments", { appointmentId: oldAppt.id, originalAmount: 3_000_000, amount: 3_000_000, method: "cash" });

    // امروز: قیمت ۴ میلیون، دستمزد پزشک ۱.۲ میلیون، مواد ۷۰۰ هزار
    const upd = await call("PUT", `/services/${svc.id}`, {
      price: 4_000_000, doctorFee: 1_200_000, materialCost: 700_000, priceChangeNote: "گران شدن مواد",
    });
    expect(upd.status).toBe(200);
    // ویرایش بدون تغییر قیمت نسخهٔ جدید نمی‌سازد
    await call("PUT", `/services/${svc.id}`, { description: "توضیح" });

    const history = (await call("GET", `/services/${svc.id}/price-history`)).json;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ price: 4_000_000, doctorFee: 1_200_000, materialCost: 700_000, note: "گران شدن مواد" });
    expect(history[0].changes).toEqual([
      { field: "price", from: 3_000_000, to: 4_000_000 },
      { field: "doctorFee", from: 1_000_000, to: 1_200_000 },
      { field: "materialCost", from: 500_000, to: 700_000 },
    ]);
    expect(history[1]).toMatchObject({ effectiveFrom: 0, price: 3_000_000, changes: [] });

    // سود نوبت دیروز با هزینهٔ دیروز (۱.۵ میلیون) می‌ماند
    let s = await summary(from, nowSec() + 3600);
    expect(s.serviceCosts - base0.serviceCosts).toBe(1_500_000);
    expect(s.netProfit - base0.netProfit).toBe(1_500_000);

    // نوبت امروز (بعد از تغییر) با هزینهٔ جدید (۱.۹ میلیون)
    const newAppt = await appointment(p.id, svc.id, Date.now() + 60_000);
    await call("POST", "/payments", { appointmentId: newAppt.id, originalAmount: 4_000_000, amount: 4_000_000, method: "cash" });
    s = await summary(from, nowSec() + 3600);
    expect(s.serviceCosts - base0.serviceCosts).toBe(1_500_000 + 1_900_000);
    expect(s.netProfit - base0.netProfit).toBe(1_500_000 + 2_100_000);

    // تفکیک هر خدمت هم با قیمت روز خدمت: دستمزد ۱.۰ + ۱.۲، مواد ۰.۵ + ۰.۷
    const byService = (await call("GET", `/accounting/by-service?from=${from}&to=${nowSec() + 3600}`)).json;
    expect(byService.find((r: { serviceId: number }) => r.serviceId === svc.id)).toMatchObject({
      revenue: 7_000_000, doctorFeeTotal: 2_200_000, materialCostTotal: 1_200_000, totalServiceCost: 3_400_000, profit: 3_600_000,
    });
  });

  it("a change can be dated back, which then applies to services from that day on", async () => {
    const svc = (await call("POST", "/services", { name: "عطف به ماسبق", price: 1_000_000, doctorFee: 300_000 })).json;
    const p = await patient("گذشته");
    const a = await appointment(p.id, svc.id, Date.now() - 3 * DAY * 1000);
    const from = nowSec() - 5;
    const base0 = (await summary(from, nowSec() + 3600)).serviceCosts;
    await call("POST", "/payments", { appointmentId: a.id, originalAmount: 1_000_000, amount: 1_000_000, method: "cash" });
    expect((await summary(from, nowSec() + 3600)).serviceCosts - base0).toBe(300_000);

    const tenDaysAgo = new Date(Date.now() - 10 * DAY * 1000 + 12_600_000).toISOString().slice(0, 10);
    const r = await call("PUT", `/services/${svc.id}`, { doctorFee: 400_000, priceEffectiveDate: tenDaysAgo });
    expect(r.status).toBe(200);
    expect((await summary(from, nowSec() + 3600)).serviceCosts - base0).toBe(400_000);

    expect((await call("PUT", `/services/${svc.id}`, { doctorFee: 1, priceEffectiveDate: "1405/07/01" })).status).toBe(400);
  });
});

describe("debts on the accounting page (outside profit)", () => {
  it("shows unsettled purchases and patient balances without touching profit", async () => {
    const from = nowSec() - 5;
    const before = await summary(from, nowSec() + 3600);
    const d0 = (await call("GET", "/accounting/debts")).json;

    const buy = (price: number, isSettled: boolean, supplier = "پخش آریا") =>
      call("POST", "/purchases", { productType: "فیلر", productName: "لوناژل", supplier, price, purchaseDate: nowSec(), isSettled });
    const open1 = await buy(5_000_000, false);
    expect(open1.status).toBe(201);
    await buy(2_000_000, false, "");
    await buy(9_000_000, true);

    const svc = (await call("POST", "/services", { name: "بدهی مراجع", price: 3_000_000, doctorFee: 1_000_000 })).json;
    const a = await appointment((await patient("بدهکار حساب")).id, svc.id);
    await call("POST", "/payments", { appointmentId: a.id, originalAmount: 3_000_000, amount: 2_500_000, method: "card" });

    const d = (await call("GET", "/accounting/debts")).json;
    expect(d.suppliers.total - d0.suppliers.total).toBe(7_000_000);
    expect(d.suppliers.count - d0.suppliers.count).toBe(2);
    expect(d.suppliers.bySupplier.find((r: { supplier: string | null }) => r.supplier === "پخش آریا").total).toBeGreaterThanOrEqual(5_000_000);
    expect(d.suppliers.bySupplier.some((r: { supplier: string | null }) => r.supplier === null)).toBe(true);
    expect(d.patients.total - d0.patients.total).toBe(500_000);

    // خرید (تسویه‌شده یا نشده) در سود و زیان نیست: فقط پرداخت و هزینهٔ خدمت عوض شده
    const after = await summary(from, nowSec() + 3600);
    expect(after.revenue - before.revenue).toBe(2_500_000);
    expect(after.totalCosts - before.totalCosts).toBe(1_000_000);

    // تسویهٔ خرید بدهی را کم می‌کند
    await call("PUT", `/purchases/${open1.json.id}`, { isSettled: true });
    const d2 = (await call("GET", "/accounting/debts")).json;
    expect(d.suppliers.total - d2.suppliers.total).toBe(5_000_000);
  });
});

describe("profit details per service and visit", () => {
  it("lists each visit's received amount, cost parts and profit, and groups by price version over time", async () => {
    const svc = (await call("POST", "/services", { name: "فیلر جزئیات", price: 4_000_000, doctorFee: 1_000_000, materialCost: 800_000, otherCost: 200_000 })).json;
    const p = await patient("جزئیات سود");
    const from = nowSec() - 5;
    // دو هفته پیش با هزینهٔ قدیم و قیمت کامل
    const old = await appointment(p.id, svc.id, Date.now() - 14 * DAY * 1000);
    await call("POST", "/payments", { appointmentId: old.id, originalAmount: 4_000_000, amount: 4_000_000, method: "cash" });
    // هزینهٔ مواد از امروز گران شد
    await call("PUT", `/services/${svc.id}`, { materialCost: 1_300_000, priceChangeNote: "گرانی مواد" });
    // امروز با تخفیف توافقی
    const now = await appointment(p.id, svc.id, Date.now() + 60_000);
    await call("POST", "/payments", { appointmentId: now.id, originalAmount: 4_000_000, amount: 3_700_000, method: "card", settleInFull: true });

    const to = nowSec() + 3600;
    const r = await call("GET", `/accounting/profit-details?from=${from}&to=${to}`);
    expect(r.status).toBe(200);
    const row = r.json.services.find((x: { serviceId: number }) => x.serviceId === svc.id);
    expect(row).toMatchObject({
      count: 2, revenue: 7_700_000, doctorCost: 2_000_000, materialCost: 2_100_000, otherCost: 400_000,
      serviceCost: 4_500_000, profit: 3_200_000,
    });
    expect(row.visits.map((v: { profit: number }) => v.profit)).toEqual([2_000_000, 1_200_000]);
    expect(row.visits[1]).toMatchObject({ revenue: 3_700_000, doctorCost: 1_000_000, materialCost: 1_300_000, otherCost: 200_000, patientName: "جزئیات سود" });
    // دو دوره: قبل و بعد از گرانی مواد؛ سود هر نوبت از ۲ میلیون به ۱.۲ میلیون
    expect(row.periods).toHaveLength(2);
    expect(row.periods.map((x: { avgProfit: number }) => x.avgProfit)).toEqual([2_000_000, 1_200_000]);
    expect(row.periods[1]).toMatchObject({ count: 1, avgMaterialCost: 1_300_000 });

    // با تفکیک خدمات (by-service) همخوان است
    const bs = (await call("GET", `/accounting/by-service?from=${from}&to=${to}`)).json.find((x: { serviceId: number }) => x.serviceId === svc.id);
    expect(bs).toMatchObject({ revenue: row.revenue, totalServiceCost: row.serviceCost, profit: row.profit });
  });
});

describe("a package billed on one appointment (cost scales with the billed amount)", () => {
  it("26.29M billed for a 2.4M service with 29% margin: cost scales ×(26.29/2.4), so the club credit is ~5% of 7.67M, not of 24.6M", async () => {
    const settings = (await call("GET", "/loyalty/settings")).json;
    await call("PUT", "/loyalty/settings", { ...settings, enabled: true, profitRewardPercent: 5 });
    try {
      const svc = (await call("POST", "/services", { name: "اپرا پکیج", price: 2_400_000, doctorFee: 1_300_000, materialCost: 300_000, otherCost: 100_000 })).json;
      const p = await patient("خرامان");
      const a = await appointment(p.id, svc.id);
      const from = nowSec() - 5;
      const base0 = await summary(from, nowSec() + 5);
      const pay = await call("POST", "/payments", { appointmentId: a.id, originalAmount: 26_290_000, amount: 26_290_000, method: "card" });
      expect(pay.status).toBe(201);
      // هزینه = ۱.۷ م × ۲۶.۲۹ / ۲.۴ ≈ ۱۸٬۶۲۲٬۰۸۴ → سود ≈ ۷٬۶۶۷٬۹۱۶ → ۵٪ = ۳۸۳ هزار
      const w = (await dbm.db.select().from(dbm.patientsTable).all()).find((x) => x.id === p.id);
      expect(w?.accountBalance).toBe(383_000);

      const s = await summary(from, nowSec() + 5);
      expect(s.serviceCosts - base0.serviceCosts).toBe(18_622_084);
      const det = (await call("GET", `/accounting/profit-details?from=${from}&to=${nowSec() + 5}`)).json;
      expect(det.services.find((x: { serviceId: number }) => x.serviceId === svc.id)).toMatchObject({ serviceCost: 18_622_084, profit: 7_667_916 });

      // تخفیف توافقی هزینه را کم نمی‌کند (ضریب حداقل ۱)
      const b = await appointment(p.id, svc.id);
      await call("POST", "/payments", { appointmentId: b.id, originalAmount: 2_400_000, amount: 2_000_000, method: "card", settleInFull: true });
      const det2 = (await call("GET", `/accounting/profit-details?from=${from}&to=${nowSec() + 5}`)).json;
      const v = det2.services.find((x: { serviceId: number }) => x.serviceId === svc.id).visits.find((x: { appointmentId: number }) => x.appointmentId === b.id);
      expect(v).toMatchObject({ revenue: 2_000_000, serviceCost: 1_700_000, profit: 300_000 });
    } finally {
      await call("PUT", "/loyalty/settings", { ...settings, enabled: false });
    }
  });

  it("deleting an appointment together with its payments takes its revenue and the whole profit credit back", async () => {
    const settings = (await call("GET", "/loyalty/settings")).json;
    await call("PUT", "/loyalty/settings", { ...settings, enabled: true, profitRewardPercent: 5 });
    try {
      const svc = (await call("POST", "/services", { name: "حذف با پرداخت", price: 3_000_000, doctorFee: 1_000_000 })).json;
      const p = await patient("حذف‌کامل");
      const a = await appointment(p.id, svc.id);
      const from = nowSec() - 5;
      const base0 = await summary(from, nowSec() + 5);
      await call("POST", "/payments", { appointmentId: a.id, originalAmount: 3_000_000, amount: 500_000, method: "cash", notes: "بیعانه" });
      await call("POST", "/payments", { appointmentId: a.id, originalAmount: 3_000_000, amount: 2_500_000, method: "card" });
      const bal = async () => (await dbm.db.select().from(dbm.patientsTable).all()).find((x) => x.id === p.id)?.accountBalance;
      expect(await bal()).toBe(100_000);

      // بدون اجازهٔ حذف پرداخت‌ها رد می‌شود
      const refused = await call("DELETE", `/appointments/${a.id}`);
      expect(refused.status).toBe(400);
      expect(refused.json.hasPayments).toBe(true);

      expect((await call("DELETE", `/appointments/${a.id}?withPayments=1`)).status).toBe(204);
      expect(await bal()).toBe(0);
      const left = (await dbm.db.select().from(dbm.paymentsTable).all()).filter((x) => x.appointmentId === a.id);
      expect(left).toHaveLength(0);
      const s = await summary(from, nowSec() + 5);
      expect(s.revenue - base0.revenue).toBe(0);
      expect(s.serviceCosts - base0.serviceCosts).toBe(0);
    } finally {
      await call("PUT", "/loyalty/settings", { ...settings, enabled: false });
    }
  });

  it("corrects credits given earlier with a single-session cost (one-time fix)", async () => {
    const svc = (await call("POST", "/services", { name: "اصلاح قدیمی", price: 2_000_000, doctorFee: 1_000_000 })).json;
    const p = await patient("اعتبار زیادی");
    const a = await appointment(p.id, svc.id);
    // پرداخت ۱۰ میلیونی (۵ جلسه) با اعتبار قدیمیِ اشتباه: ۵٪ × (۱۰ م − ۱ م) = ۴۵۰ هزار
    const [pay] = await dbm.db.insert(dbm.paymentsTable).values({ appointmentId: a.id, originalAmount: 10_000_000, amount: 10_000_000, method: "card", paidAt: nowSec() }).returning();
    const loyalty = await import("../src/lib/loyalty");
    await loyalty.creditWallet(dbm.db, p.id, 450_000, "loyalty_cashback", "اعتبار سود خدمت", pay.id);
    const fixed = await loyalty.fixOverstatedCashback(dbm.db);
    // درست: ۵٪ × (۱۰ م − ۵ م) = ۲۵۰ هزار → ۲۰۰ هزار کسر می‌شود
    expect(fixed.find((f) => f.appointmentId === a.id)?.removed).toBe(200_000);
    expect(await loyalty.getWalletBalance(dbm.db, p.id)).toBe(250_000);
    // اجرای دوباره چیزی کم نمی‌کند
    expect((await loyalty.fixOverstatedCashback(dbm.db)).find((f) => f.appointmentId === a.id)).toBeUndefined();
  });
});

describe("per-unit price with fixed («کل») costs — Opera, 11 cc", () => {
  it("2,390,000 per cc, costs 1.3M + 300k + 100k «کل»: 11 cc → cost 18.7M, profit 7.59M; the old 1,106,000 credit is corrected", async () => {
    const svc = (await call("POST", "/services", {
      name: "اپرا سی‌سی", price: 2_390_000, priceMode: "per_unit", unitCount: 1,
      doctorFee: 1_300_000, materialCost: 300_000, otherCost: 100_000,
    })).json;
    const p = await patient("خرامان دارابی");
    const a = await appointment(p.id, svc.id);
    const from = nowSec() - 5;
    const base0 = await summary(from, nowSec() + 5);
    const pay = await call("POST", "/payments", { appointmentId: a.id, originalAmount: 26_290_000, amount: 26_290_000, unitsUsed: 11, method: "cash" });
    expect(pay.status).toBe(201);

    const s = await summary(from, nowSec() + 5);
    expect(s.serviceCosts - base0.serviceCosts).toBe(18_700_000);
    const det = (await call("GET", `/accounting/profit-details?from=${from}&to=${nowSec() + 5}`)).json;
    expect(det.services.find((x: { serviceId: number }) => x.serviceId === svc.id)).toMatchObject({ serviceCost: 18_700_000, profit: 7_590_000 });

    // اعتبار اشتباه نسخهٔ قبل (۴.۵٪ از ۲۴.۵۹ م) با اصلاح یک‌باره به ۴.۵٪ از ۷.۵۹ م ≈ ۳۴۱ هزار می‌رسد
    const loyalty = await import("../src/lib/loyalty");
    await loyalty.creditWallet(dbm.db, p.id, 1_106_000, "loyalty_cashback", "اعتبار سود خدمت (اپرا)", pay.json.id);
    await loyalty.fixOverstatedCashback(dbm.db);
    expect(await loyalty.getWalletBalance(dbm.db, p.id)).toBe(341_000);
  });
});

describe("a past service paid now can be recorded on the service date", () => {
  it("revenue and cost land in the service's month when paidAt is sent; a future date is refused", async () => {
    const svc = (await call("POST", "/services", { name: "خدمت ماه قبل", price: 2_000_000, doctorFee: 500_000 })).json;
    const p = await patient("ثبت دیرهنگام");
    const serviceMs = Date.now() - 40 * DAY * 1000;
    const a = await appointment(p.id, svc.id, serviceMs);
    const serviceSec = Math.floor(serviceMs / 1000);
    const then0 = await summary(serviceSec - 3600, serviceSec + 3600);
    const now0 = await summary(nowSec() - 60, nowSec() + 60);

    const future = await call("POST", "/payments", { appointmentId: a.id, originalAmount: 2_000_000, amount: 2_000_000, method: "cash", paidAt: nowSec() + 86400 });
    expect(future.status).toBe(400);

    const pay = await call("POST", "/payments", { appointmentId: a.id, originalAmount: 2_000_000, amount: 2_000_000, method: "cash", paidAt: serviceSec });
    expect(pay.status).toBe(201);
    expect(pay.json.paidAt).toBe(serviceSec);

    const then1 = await summary(serviceSec - 3600, serviceSec + 3600);
    const now1 = await summary(nowSec() - 60, nowSec() + 60);
    expect(then1.revenue - then0.revenue).toBe(2_000_000);
    expect(then1.serviceCosts - then0.serviceCosts).toBe(500_000);
    expect(now1.revenue - now0.revenue).toBe(0);

    // فهرست صندوق تاریخ خدمت را کنار پرداخت دارد
    const list = (await call("GET", "/payments")).json;
    expect(list.find((x: { id: number }) => x.id === pay.json.id).serviceScheduledAt).toBe(serviceMs);
  });
});

describe("one-time fix: old payments recorded after the service month move to the service date", () => {
  it("moves a later-month checkout payment and its commission; leaves deposits and same-month payments alone", async () => {
    const backfill = await import("../src/lib/backfill");
    const svc = (await call("POST", "/services", { name: "اینووسنس مرداد", price: 2_000_000, doctorFee: 500_000 })).json;
    const p = await patient("مرداد");
    const serviceMs = Date.now() - 70 * DAY * 1000;
    const svcSec = Math.floor(serviceMs / 1000);
    const a = await appointment(p.id, svc.id, serviceMs);
    // بیعانه قبل از خدمت، و تسویه‌ای که دو ماه بعد (امروز) ثبت شده
    const [dep] = await dbm.db.insert(dbm.paymentsTable).values({ appointmentId: a.id, originalAmount: 300_000, amount: 300_000, method: "cash", notes: "بیعانه", paidAt: svcSec - 2 * DAY }).returning();
    const [late] = await dbm.db.insert(dbm.paymentsTable).values({ appointmentId: a.id, originalAmount: 2_000_000, amount: 1_700_000, method: "card", paidAt: nowSec() }).returning();
    const [comm] = await dbm.db.insert(dbm.commissionsTable).values({ recipientType: "staff", recipientId: 1, appointmentId: a.id, paymentId: late.id, amount: 100_000, createdAt: nowSec() }).returning();
    // پرداختی که همان ماهِ خدمت ثبت شده (دو روز بعد از خدمتِ امروز) دست نمی‌خورد
    const b = await appointment(p.id, svc.id, Date.now() - 2 * DAY * 1000);
    const [same] = await dbm.db.insert(dbm.paymentsTable).values({ appointmentId: b.id, originalAmount: 2_000_000, amount: 2_000_000, method: "cash", paidAt: nowSec() }).returning();

    await backfill.movePaymentsToServiceMonth();

    const pays = await dbm.db.select().from(dbm.paymentsTable).all();
    expect(pays.find((x) => x.id === late.id)?.paidAt).toBe(svcSec);
    expect(pays.find((x) => x.id === dep.id)?.paidAt).toBe(svcSec - 2 * DAY);
    const sameAfter = pays.find((x) => x.id === same.id)?.paidAt;
    const sameMonth = new Intl.DateTimeFormat("en-u-ca-persian", { month: "numeric", timeZone: "Asia/Tehran" });
    if (sameMonth.format(new Date(same.paidAt * 1000)) === sameMonth.format(new Date(Date.now() - 2 * DAY * 1000))) {
      expect(sameAfter).toBe(same.paidAt);
    }
    const c = (await dbm.db.select().from(dbm.commissionsTable).all()).find((x) => x.id === comm.id);
    expect(c?.createdAt).toBe(svcSec);

    // درآمد و هزینهٔ آن در ماهِ خدمت است
    const then = await summary(svcSec - 3 * DAY, svcSec + DAY);
    expect(then.revenue).toBeGreaterThanOrEqual(2_000_000);
    // اجرای دوباره چیزی را جابه‌جا نمی‌کند
    expect(await backfill.movePaymentsToServiceMonth()).toBe(0);
  });
});
