import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

// ویرایش پرداخت (PUT /payments/:id) و ارسال دوبارهٔ پیامک رسید.
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

async function call(method: string, p: string, body?: unknown, role = "admin") {
  const headers: Record<string, string> = { "x-test-role": role };
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

let fileSeq = 0;
async function patient(name: string) {
  const [p] = await dbm.db.insert(dbm.patientsTable)
    .values({ name, phone: "09121234567", fileNumber: `PE${++fileSeq}` }).returning();
  return p;
}
async function appointment(patientId: number, serviceId: number, scheduledAtMs = Date.now()) {
  const r = await call("POST", "/appointments", { patientId, serviceId, scheduledAt: scheduledAtMs });
  expect(r.status).toBe(201);
  return r.json;
}
async function summary(from: number, to: number) {
  return (await call("GET", `/accounting/summary?from=${from}&to=${to}`)).json;
}
async function wallet(patientId: number) {
  const row = await dbm.db.select().from(dbm.patientsTable).all();
  return row.find((x) => x.id === patientId)?.accountBalance;
}
const nowSec = () => Math.floor(Date.now() / 1000);

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "payment-edit-test-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-clinic.db");
  dbm = await import("@workspace/db");
  await dbm.runMigrations(MIGRATIONS_DIR);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = String(req.headers["x-test-role"] ?? "admin");
    (req as unknown as { jwtUser: unknown }).jwtUser = { sub: role === "admin" ? 1 : 2, role, username: role };
    next();
  });
  for (const mod of ["payments", "appointments", "services", "accounting", "loyalty", "reminders"]) {
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

describe("PUT /payments/:id", () => {
  it("editing the amount updates revenue and recomputes the club profit credit with no leftover", async () => {
    const settings = (await call("GET", "/loyalty/settings")).json;
    await call("PUT", "/loyalty/settings", { ...settings, enabled: true, profitRewardPercent: 5 });
    try {
      const svc = (await call("POST", "/services", { name: "ویرایش باشگاه", price: 3_000_000, doctorFee: 1_800_000 })).json;
      const p = await patient("ویرایشی");
      const a = await appointment(p.id, svc.id);
      const from = nowSec() - 5;
      const due = new Date(Date.now() + 30 * DAY * 1000).toISOString().slice(0, 10);

      const pay = await call("POST", "/payments", {
        appointmentId: a.id, originalAmount: 3_000_000, amount: 3_000_000, method: "cash",
        reminder: { type: "followup", dueDate: due },
      });
      expect(pay.status).toBe(201);
      expect(await wallet(p.id)).toBe(60_000); // ۵٪ × ۱,۲۰۰,۰۰۰
      expect((await summary(from, nowSec() + 5)).revenue).toBe(3_000_000);

      // مبلغ کمتر + تسویه کامل (تخفیف توافقی)
      const edit = await call("PUT", `/payments/${pay.json.id}`, {
        amount: 2_800_000, originalAmount: 3_000_000, method: "card", settleInFull: true, notes: "اصلاح شد",
      });
      expect(edit.status).toBe(200);
      expect(edit.json).toMatchObject({
        id: pay.json.id, amount: 2_800_000, method: "card", notes: "اصلاح شد",
        discountAmount: 200_000, discountName: "تخفیف توافقی", paidAt: pay.json.paidAt,
      });

      expect((await summary(from, nowSec() + 5)).revenue).toBe(2_800_000);
      // ۵٪ × ۱,۰۰۰,۰۰۰ — اعتبار قبلی کامل برگشت و دوباره حساب شد
      expect(await wallet(p.id)).toBe(50_000);
      const txns = (await dbm.db.select().from(dbm.patientAccountTransactionsTable).all())
        .filter((t) => t.patientId === p.id);
      expect(txns.reduce((s, t) => s + t.amount, 0)).toBe(50_000);
      expect(txns.every((t) => t.paymentId === pay.json.id)).toBe(true);

      const appt = (await call("GET", `/appointments/${a.id}`)).json;
      expect(appt).toMatchObject({ status: "completed", price: 2_800_000, paidTotal: 2_800_000, remaining: 0 });

      // یادآوری ثبت‌شده با پرداخت حفظ می‌شود
      const reminders = (await dbm.db.select().from(dbm.remindersTable).all()).filter((r) => r.patientId === p.id);
      expect(reminders).toHaveLength(1);
      expect(reminders[0].paymentId).toBe(pay.json.id);

      // افزایش دوباره: اعتبار هم بالا می‌رود و فقط یک ردیف پرداخت وجود دارد
      const edit2 = await call("PUT", `/payments/${pay.json.id}`, { amount: 3_000_000, settleInFull: false });
      expect(edit2.status).toBe(200);
      expect(edit2.json.discountAmount ?? null).toBeNull();
      expect(await wallet(p.id)).toBe(60_000);
      const rows = (await call("GET", "/payments")).json.filter((x: { appointmentId: number }) => x.appointmentId === a.id);
      expect(rows).toHaveLength(1);
    } finally {
      await call("PUT", "/loyalty/settings", { ...settings, enabled: false });
    }
  });

  it("a lower amount without settling stays as debt", async () => {
    const svc = (await call("POST", "/services", { name: "بدهی ویرایش", price: 1_000_000 })).json;
    const a = await appointment((await patient("بدهکار ویرایش")).id, svc.id);
    const pay = await call("POST", "/payments", { appointmentId: a.id, originalAmount: 1_000_000, amount: 1_000_000, method: "cash" });
    const edit = await call("PUT", `/payments/${pay.json.id}`, { amount: 600_000 });
    expect(edit.status).toBe(200);
    expect((await call("GET", `/appointments/${a.id}`)).json).toMatchObject({ remaining: 400_000, status: "completed" });
  });

  it("non-admin users get 403", async () => {
    const svc = (await call("POST", "/services", { name: "غیرمدیر", price: 500_000 })).json;
    const a = await appointment((await patient("غیرمدیر")).id, svc.id);
    const pay = await call("POST", "/payments", { appointmentId: a.id, originalAmount: 500_000, amount: 500_000, method: "cash" });
    const r = await call("PUT", `/payments/${pay.json.id}`, { amount: 100 }, "receptionist");
    expect(r.status).toBe(403);
    expect(typeof r.json.error).toBe("string");
    const after = (await call("GET", `/payments/${pay.json.id}`)).json;
    expect(after.amount).toBe(500_000);
  });

  it("editing paidAt moves the revenue between days", async () => {
    const svc = (await call("POST", "/services", { name: "جابجایی روز", price: 700_000 })).json;
    const a = await appointment((await patient("جابجایی")).id, svc.id);
    const from = nowSec() - 5;
    const pay = await call("POST", "/payments", { appointmentId: a.id, originalAmount: 700_000, amount: 700_000, method: "cash" });
    const todayBefore = (await summary(from, nowSec() + 5)).revenue;

    const threeDaysAgo = nowSec() - 3 * DAY;
    const dayFrom = threeDaysAgo - 3600;
    const dayTo = threeDaysAgo + 3600;
    const pastBefore = (await summary(dayFrom, dayTo)).revenue;

    const r = await call("PUT", `/payments/${pay.json.id}`, { paidAt: threeDaysAgo });
    expect(r.status).toBe(200);
    expect(r.json.paidAt).toBe(threeDaysAgo);
    expect((await summary(from, nowSec() + 5)).revenue).toBe(todayBefore - 700_000);
    expect((await summary(dayFrom, dayTo)).revenue).toBe(pastBefore + 700_000);
  });

  it("refuses when a linked commission is already paid (same error as delete)", async () => {
    const svc = (await call("POST", "/services", { name: "پورسانت تسویه", price: 900_000 })).json;
    const a = await appointment((await patient("پورسانتی")).id, svc.id);
    const pay = await call("POST", "/payments", { appointmentId: a.id, originalAmount: 900_000, amount: 900_000, method: "cash" });
    await dbm.db.insert(dbm.commissionsTable).values({
      recipientType: "external", recipientId: 999, appointmentId: a.id, paymentId: pay.json.id,
      amount: 90_000, isPaid: true, status: "paid",
    });
    const del = await call("DELETE", `/payments/${pay.json.id}`);
    const r = await call("PUT", `/payments/${pay.json.id}`, { amount: 800_000 });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe(del.json.error);
    expect((await call("GET", `/payments/${pay.json.id}`)).json.amount).toBe(900_000);
  });

  it("returns 404 for a missing payment", async () => {
    expect((await call("PUT", "/payments/999999", { amount: 1 })).status).toBe(404);
  });
});

describe("POST /payments/:id/send-receipt", () => {
  it("returns a Persian error when SMS is not configured", async () => {
    const svc = (await call("POST", "/services", { name: "رسید", price: 400_000 })).json;
    const a = await appointment((await patient("رسیدی")).id, svc.id);
    const pay = await call("POST", "/payments", { appointmentId: a.id, originalAmount: 400_000, amount: 400_000, method: "cash" });
    const r = await call("POST", `/payments/${pay.json.id}/send-receipt`);
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/پنل پیامکی/);
    expect((await call("POST", "/payments/999999/send-receipt")).status).toBe(404);
  });
});
