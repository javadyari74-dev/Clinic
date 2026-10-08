import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

// اعتبار سودِ پرداخت‌های قبلی: پرداخت‌هایی که پیش از فعال شدن اعتبار سود ثبت شده‌اند.
// مسیر فقط برای مدیر است؛ این‌جا احراز هویت کنار گذاشته شده و ارسال پیامک mock است.

vi.mock("../src/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/auth")>();
  return { ...actual, requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next() };
});

const { sent } = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; text: string; eventType: string; patientId?: number | null }>,
}));

vi.mock("../src/lib/sms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/sms")>();
  return {
    ...actual,
    sendSms: vi.fn(async (input: (typeof sent)[number]) => {
      sent.push(input);
      return { ok: true };
    }),
  };
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../lib/db/migrations");
const MIN = 60_000;
const tehranSec = (y: number, m: number, d: number, h = 12) => Math.floor((Date.UTC(y, m - 1, d, h) - 210 * MIN) / 1000);

let dbm: typeof import("@workspace/db");
let loyalty: typeof import("../src/lib/loyalty");
let server: http.Server;
let base: string;
let serviceId = 0;
let costlyServiceId = 0;

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
    .values({ name, phone: "09121234567", fileNumber: `R${++fileSeq}` }).returning();
  return p;
}
async function appointment(patientId: number, svc = serviceId) {
  const [a] = await dbm.db.insert(dbm.appointmentsTable)
    .values({ patientId, serviceId: svc, scheduledAt: Date.now(), status: "completed" }).returning();
  return a;
}
// پرداختِ «نسخهٔ قبلی»: مستقیم در جدول، بدون هیچ اعتبار
async function oldPayment(appointmentId: number, amount: number, paidAt: number) {
  const [p] = await dbm.db.insert(dbm.paymentsTable)
    .values({ appointmentId, originalAmount: amount, amount, method: "card", paidAt }).returning();
  return p;
}
const wallet = (pid: number) => loyalty.getWalletBalance(dbm.db, pid);

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loyalty-retro-test-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-clinic.db");
  dbm = await import("@workspace/db");
  await dbm.runMigrations(MIGRATIONS_DIR);
  loyalty = await import("../src/lib/loyalty");
  const { default: paymentsRouter } = await import("../src/routes/payments");
  const { default: loyaltyRouter } = await import("../src/routes/loyalty");

  const [svc] = await dbm.db.insert(dbm.servicesTable).values({ name: "بوتاکس", price: 1 }).returning();
  serviceId = svc.id;
  const [costly] = await dbm.db.insert(dbm.servicesTable)
    .values({ name: "فیلر", price: 1, doctorFee: 1_000_000 }).returning();
  costlyServiceId = costly.id;

  const app = express();
  app.use(express.json());
  app.use(paymentsRouter);
  app.use(loyaltyRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  sent.length = 0;
});

describe("profit credit for earlier payments", () => {
  it("previews, then credits each earlier paid appointment once, and sends the optional SMS", async () => {
    const sara = await patient("سارا");
    const mina = await patient("مینا");
    const a1 = await appointment(sara.id);
    await oldPayment(a1.id, 2_000_000, tehranSec(2026, 9, 20)); // بیعانه
    await oldPayment(a1.id, 8_000_000, tehranSec(2026, 10, 1)); // تسویه → جمع ۱۰ میلیون → ۵۰۰ هزار
    const a2 = await appointment(mina.id, costlyServiceId);
    await oldPayment(a2.id, 3_000_000, tehranSec(2026, 10, 2)); // ۳ میلیون − ۱ میلیون هزینه → ۱۰۰ هزار
    const a3 = await appointment(mina.id);
    await oldPayment(a3.id, 4_000_000, tehranSec(2026, 6, 1)); // بیرون از بازه

    await call("PUT", "/loyalty/settings", { ...(await loyalty.getLoyaltySettings()), enabled: true, profitRewardPercent: 5 });

    const range = { from: "2026-09-01", to: "2026-10-05" };
    const preview = await call("POST", "/loyalty/retro-cashback", { ...range, apply: false });
    expect(preview.status).toBe(200);
    expect(preview.json).toMatchObject({ appointments: 2, total: 600_000, smsSent: 0 });
    expect(preview.json.patients).toEqual([
      { patientId: sara.id, name: "سارا", amount: 500_000, appointments: 1 },
      { patientId: mina.id, name: "مینا", amount: 100_000, appointments: 1 },
    ]);
    expect(await wallet(sara.id)).toBe(0); // پیش‌نمایش چیزی ثبت نمی‌کند

    const applied = await call("POST", "/loyalty/retro-cashback", {
      ...range, apply: true, smsText: "{نام} عزیز، {اعتبار} تومان اعتبار هدیه؛ موجودی: {موجودی} تومان",
    });
    expect(applied.json).toMatchObject({ appointments: 2, total: 600_000, smsSent: 2, smsFailed: 0 });
    expect(await wallet(sara.id)).toBe(500_000);
    expect(await wallet(mina.id)).toBe(100_000);
    expect(sent.map((s) => s.text)).toContain("سارا عزیز، ۵۰۰,۰۰۰ تومان اعتبار هدیه؛ موجودی: ۵۰۰,۰۰۰ تومان");

    const history = await call("GET", `/patients/${sara.id}/loyalty`);
    expect(history.json.transactions[0]).toMatchObject({ type: "cashback", amount: 500_000 });

    // اجرای دوباره چیزی اضافه نمی‌کند
    const again = await call("POST", "/loyalty/retro-cashback", { ...range, apply: true });
    expect(again.json).toMatchObject({ appointments: 0, total: 0 });

    // بدون بازه: نوبت بیرون از بازهٔ قبلی هم حساب می‌شود
    const all = await call("POST", "/loyalty/retro-cashback", { apply: true });
    expect(all.json).toMatchObject({ appointments: 1, total: 200_000 });
    expect(await wallet(mina.id)).toBe(300_000);
  });

  it("does not pay twice when a later payment on the same appointment comes through checkout", async () => {
    const p = await patient("ادامه");
    const a = await appointment(p.id);
    await oldPayment(a.id, 4_000_000, tehranSec(2026, 10, 3));
    await call("POST", "/loyalty/retro-cashback", { apply: true });
    expect(await wallet(p.id)).toBe(200_000);

    const r = await call("POST", "/payments", { appointmentId: a.id, originalAmount: 2_000_000, amount: 2_000_000, method: "card" });
    expect(r.status).toBe(201);
    expect(await wallet(p.id)).toBe(300_000); // ۶ میلیون × ۵٪
  });

  it("deleting the payment the earlier credit is attached to takes it back", async () => {
    const p = await patient("حذف");
    const a = await appointment(p.id);
    const pay = await oldPayment(a.id, 2_000_000, tehranSec(2026, 10, 4));
    await call("POST", "/loyalty/retro-cashback", { apply: true });
    expect(await wallet(p.id)).toBe(100_000);
    expect((await call("DELETE", `/payments/${pay.id}`)).status).toBeLessThan(300);
    expect(await wallet(p.id)).toBe(0);
  });

  it("rejects an invalid range", async () => {
    const r = await call("POST", "/loyalty/retro-cashback", { from: "2026-10-05", to: "2026-10-01", apply: false });
    expect(r.status).toBe(400);
  });
});
