import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

// یکپارچگی مالی نوبت/پرداخت/کمیسیون/کیف پول: مسیرهای واقعی روی SQLite موقت؛ پیامک mock شده است.

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

// حذف مراجع فقط برای مدیر است؛ در این تست مجوز همیشه داده می‌شود
vi.mock("../src/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/auth")>();
  return { ...actual, requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next() };
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../lib/db/migrations");

let dbm: typeof import("@workspace/db");
let orm: typeof import("drizzle-orm");
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
async function patient(name: string, extra: Partial<typeof dbm.patientsTable.$inferInsert> = {}) {
  const [p] = await dbm.db.insert(dbm.patientsTable)
    .values({ name, phone: "09121234567", fileNumber: `IP${++fileSeq}`, ...extra }).returning();
  return p;
}

let serviceId = 0;
async function appointment(patientId: number, extra: Record<string, unknown> = {}) {
  const r = await call("POST", "/appointments", { patientId, serviceId, scheduledAt: Date.now(), ...extra });
  expect(r.status).toBe(201);
  return r.json;
}
async function pay(appointmentId: number, originalAmount: number, amount: number, extra: Record<string, unknown> = {}) {
  return call("POST", "/payments", { appointmentId, originalAmount, amount, method: "card", ...extra });
}
const getAppt = async (id: number) => (await call("GET", `/appointments/${id}`)).json;
const wallet = async (pid: number) =>
  (await dbm.db.select().from(dbm.patientsTable).where(orm.eq(dbm.patientsTable.id, pid)).get())?.accountBalance;
const commissionsOf = (paymentId: number) =>
  dbm.db.select().from(dbm.commissionsTable).where(orm.eq(dbm.commissionsTable.paymentId, paymentId));

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "integrity-payments-test-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-clinic.db");
  dbm = await import("@workspace/db");
  orm = await import("drizzle-orm");
  await dbm.runMigrations(MIGRATIONS_DIR);

  const app = express();
  app.use(express.json());
  for (const mod of ["payments", "appointments", "patients", "staff", "commission-recipients", "commissions", "reminders", "loyalty"]) {
    const { default: r } = await import(`../src/routes/${mod}.ts`);
    app.use(r);
  }
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const [svc] = await dbm.db.insert(dbm.servicesTable).values({ name: "مزوتراپی", price: 1_000_000 }).returning();
  serviceId = svc.id;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("appointment deletion", () => {
  it("refuses to delete an appointment that has payments (single and bulk)", async () => {
    const p = await patient("حذف نوبت");
    const a = await appointment(p.id, { deposit: 100_000 });
    const free = await appointment(p.id);
    const single = await call("DELETE", `/appointments/${a.id}`);
    expect(single.status).toBe(400);
    expect(single.json.error).toContain("ابتدا پرداخت‌ها را از صندوق حذف کنید");

    const bulk = await call("DELETE", "/appointments/bulk", { ids: [a.id, free.id] });
    expect(bulk.status).toBe(200);
    expect(bulk.json).toMatchObject({ deleted: 1, skipped: [a.id] });
    expect((await call("GET", `/appointments/${a.id}`)).status).toBe(200);
    expect((await call("GET", `/appointments/${free.id}`)).status).toBe(404);
  });
});

describe("partial payments and appointment status", () => {
  it("keeps the appointment open until fully paid, then completes it", async () => {
    const p = await patient("قسطی");
    const a = await appointment(p.id);
    expect((await pay(a.id, 1_000_000, 400_000)).status).toBe(201);
    let detail = await getAppt(a.id);
    expect(detail).toMatchObject({ status: "scheduled", price: 1_000_000, paidTotal: 400_000, remaining: 600_000, hasCheckoutPayment: true });

    // پرداخت بعدی: مبلغ اصلی = قیمت نوبت، پرداخت‌های قبلی کسر شده
    expect((await pay(a.id, 1_000_000, 600_000)).status).toBe(201);
    detail = await getAppt(a.id);
    expect(detail).toMatchObject({ status: "completed", paidTotal: 1_000_000, remaining: 0 });
  });

  it("counts the deposit payment toward the paid total", async () => {
    const p = await patient("بیعانه‌دار");
    const a = await appointment(p.id, { deposit: 300_000 });
    expect(await getAppt(a.id)).toMatchObject({ paidTotal: 300_000, hasCheckoutPayment: false, remaining: null });
    expect((await pay(a.id, 1_000_000, 700_000)).status).toBe(201);
    expect(await getAppt(a.id)).toMatchObject({ status: "completed", remaining: 0 });
  });

  it("deleting the checkout payment reopens the appointment and removes its follow-up reminder", async () => {
    const p = await patient("یادآوری");
    const a = await appointment(p.id);
    const r = await pay(a.id, 1_000_000, 1_000_000, { unitsUsed: 2, reminder: { type: "followup", dueDate: "2026-12-01" } });
    expect(r.status).toBe(201);
    const reminders = await dbm.db.select().from(dbm.remindersTable).where(orm.eq(dbm.remindersTable.paymentId, r.json.id));
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ type: "followup", patientId: p.id });
    expect((await getAppt(a.id)).status).toBe("completed");

    expect((await call("DELETE", `/payments/${r.json.id}`)).status).toBe(204);
    const after = await getAppt(a.id);
    expect(after).toMatchObject({ status: "confirmed", price: null, unitsUsed: null, paidTotal: 0 });
    expect(await dbm.db.select().from(dbm.remindersTable).where(orm.eq(dbm.remindersTable.paymentId, r.json.id))).toHaveLength(0);
  });
});

describe("commissions", () => {
  it("refuses to delete a payment whose commission was already paid out", async () => {
    const [s] = await dbm.db.insert(dbm.staffTable).values({ name: "منشی معرف" }).returning();
    const p = await patient("معرفی کارمند", { referrerType: "staff", referrerId: s.id, referrerRate: 10 });
    const a = await appointment(p.id);
    const r = await pay(a.id, 1_000_000, 1_000_000);
    const [c] = await commissionsOf(r.json.id);
    expect(c).toMatchObject({ amount: 100_000, recipientType: "staff", recipientId: s.id });

    const marked = await call("PUT", `/commissions/${c.id}`, { isPaid: true });
    expect(marked.json).toMatchObject({ isPaid: true, status: "paid" });

    const del = await call("DELETE", `/payments/${r.json.id}`);
    expect(del.status).toBe(400);
    expect(del.json.error).toContain("تسویه شده");
    expect(await commissionsOf(r.json.id)).toHaveLength(1);
  });

  it("gives the referrer a commission on the deposit too", async () => {
    const [rec] = await dbm.db.insert(dbm.commissionRecipientsTable).values({ name: "سالن همکار" }).returning();
    const p = await patient("معرفی سالن", { referrerType: "recipient", referrerId: rec.id, referrerRate: 10 });
    const a = await appointment(p.id, { deposit: 200_000 });
    const [deposit] = await dbm.db.select().from(dbm.paymentsTable).where(orm.eq(dbm.paymentsTable.appointmentId, a.id));
    expect(deposit.notes).toBe("بیعانه");
    expect(await commissionsOf(deposit.id)).toMatchObject([{ recipientType: "external", recipientId: rec.id, amount: 20_000 }]);

    // پروفایل گیرنده، مراجعین «recipient» را هم نشان می‌دهد
    const profile = await call("GET", `/commission-recipients/${rec.id}/referrals`);
    expect(profile.json).toMatchObject({ count: 1, totalCommission: 20_000 });
  });

  it("rejects a manual commission for the referrer that already gets the automatic one", async () => {
    const [s] = await dbm.db.insert(dbm.staffTable).values({ name: "معرف دوم" }).returning();
    const p = await patient("دوبار", { referrerType: "staff", referrerId: s.id, referrerRate: 10 });
    const a = await appointment(p.id);
    const before = (await dbm.db.select().from(dbm.paymentsTable)).length;
    const r = await pay(a.id, 1_000_000, 1_000_000, {
      manualCommission: { recipientType: "staff", recipientId: s.id, amount: 50_000 },
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("پورسانت خودکار");
    expect((await dbm.db.select().from(dbm.paymentsTable)).length).toBe(before);

    // کمیسیون دستی برای گیرندهٔ دیگر داخل همان تراکنش ثبت می‌شود
    const [other] = await dbm.db.insert(dbm.staffTable).values({ name: "تکنسین" }).returning();
    const ok = await pay(a.id, 1_000_000, 1_000_000, {
      manualCommission: { recipientType: "staff", recipientId: other.id, amount: 50_000, rate: 5 },
    });
    expect(ok.status).toBe(201);
    const rows = await commissionsOf(ok.json.id);
    expect(rows.map((c) => c.recipientId).sort()).toEqual([s.id, other.id].sort());
  });
});

describe("staff and recipients", () => {
  it("refuses to delete a staff member who is still a patient's referrer", async () => {
    const [s] = await dbm.db.insert(dbm.staffTable).values({ name: "مرجع" }).returning();
    const p = await patient("ارجاعی", { referrerType: "staff", referrerId: s.id, referrerRate: 5 });
    const r = await call("DELETE", `/staff/${s.id}`);
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("معرف");
    await dbm.db.update(dbm.patientsTable).set({ referrerType: null, referrerId: null }).where(orm.eq(dbm.patientsTable.id, p.id));
    expect((await call("DELETE", `/staff/${s.id}`)).status).toBe(204);
  });
});

describe("loyalty referral and patient deletion", () => {
  it("rejects a manual referral credit when the club already credited the referrer, and patient delete reverses it", async () => {
    const settings = (await call("GET", "/loyalty/settings")).json;
    expect((await call("PUT", "/loyalty/settings", { ...settings, enabled: true, referralBonus: 200_000, profitRewardPercent: 0 })).status).toBe(200);
    try {
      const referrer = await patient("معرف مراجع");
      const referred = await patient("معرفی‌شده", { referrerType: "patient", referrerId: referrer.id });
      const grand = await patient("نسل بعد", { referrerType: "patient", referrerId: referred.id });
      const a = await appointment(referred.id);

      const dup = await pay(a.id, 1_000_000, 1_000_000, {
        manualCommission: { recipientType: "patient", recipientId: referrer.id, amount: 100_000 },
      });
      expect(dup.status).toBe(400);
      expect(dup.json.error).toContain("اعتبار معرفی");
      expect(await wallet(referrer.id)).toBe(0);

      const ok = await pay(a.id, 1_000_000, 1_000_000);
      expect(ok.status).toBe(201);
      expect(await wallet(referrer.id)).toBe(200_000);
      // ثبت مستقیم اعتبار معرفی دستی برای همان پرداخت هم رد می‌شود
      const direct = await call("POST", `/patients/${referrer.id}/account-transactions`, {
        amount: 50_000, type: "referral_credit", paymentId: ok.json.id,
      });
      expect(direct.status).toBe(400);
      expect(await wallet(referrer.id)).toBe(200_000);

      expect((await call("DELETE", `/patients/${referred.id}`)).status).toBe(204);
      expect(await wallet(referrer.id)).toBe(0);
      const g = await dbm.db.select().from(dbm.patientsTable).where(orm.eq(dbm.patientsTable.id, grand.id)).get();
      expect(g).toMatchObject({ referrerId: null, referrerType: null });
    } finally {
      await call("PUT", "/loyalty/settings", { ...settings, enabled: false });
    }
  });
});

describe("discounts", () => {
  it("enforces the usage limit inside the payment transaction", async () => {
    const [d] = await dbm.db.insert(dbm.discountsTable).values({
      name: "یک‌بار", code: "ONCE", type: "percentage", value: 10, usageLimit: 1,
    }).returning();
    const p = await patient("تخفیفی");
    const a1 = await appointment(p.id);
    const first = await pay(a1.id, 1_000_000, 900_000, { discountId: d.id });
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ discountAmount: 100_000, discountName: "یک‌بار" });
    expect(await getAppt(a1.id)).toMatchObject({ price: 900_000, status: "completed" });

    const a2 = await appointment(p.id);
    const second = await pay(a2.id, 1_000_000, 900_000, { discountId: d.id });
    expect(second.status).toBe(400);
    expect(second.json.error).toContain("ظرفیت");
    const row = await dbm.db.select().from(dbm.discountsTable).where(orm.eq(dbm.discountsTable.id, d.id)).get();
    expect(row?.usageCount).toBe(1);
  });
});

describe("appointment numbering and time units", () => {
  it("numbers sessions with max+1 over non-cancelled appointments", async () => {
    const p = await patient("جلسه‌ها");
    const s1 = await appointment(p.id);
    const s2 = await appointment(p.id);
    expect([s1.sessionNumber, s2.sessionNumber]).toEqual([1, 2]);
    expect((await call("DELETE", `/appointments/${s1.id}`)).status).toBe(204);
    const s3 = await appointment(p.id);
    expect(s3.sessionNumber).toBe(3);
    await call("PUT", `/appointments/${s3.id}`, { status: "cancelled" });
    const s4 = await appointment(p.id);
    expect(s4.sessionNumber).toBe(3);
  });

  it("stores a seconds scheduledAt as milliseconds", async () => {
    const p = await patient("ثانیه");
    const sec = 1_790_000_000;
    const a = await appointment(p.id, { scheduledAt: sec });
    expect(a.scheduledAt).toBe(sec * 1000);
    const moved = await call("PUT", `/appointments/${a.id}`, { scheduledAt: sec + 3600 });
    expect(moved.json.scheduledAt).toBe((sec + 3600) * 1000);
  });

  it("logs status changes with Persian labels", async () => {
    const p = await patient("وضعیت");
    const a = await appointment(p.id);
    await call("PUT", `/appointments/${a.id}`, { status: "confirmed" });
    const log = await dbm.db.select().from(dbm.activityLogTable).orderBy(orm.desc(dbm.activityLogTable.id)).get();
    expect(log?.description).toContain("تایید شده");
  });
});
