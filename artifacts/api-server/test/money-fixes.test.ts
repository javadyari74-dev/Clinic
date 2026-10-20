import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

// اصلاحات مالی پرداخت‌ها: امتیاز، اعتبار سود، اعتبار معرفی، کمیسیون، قیمت نوبت، ویرایش پرداخت.
// مسیرهای واقعی روی SQLite موقت؛ پیامک mock شده است. احراز هویت واقعی است (نقش از پایگاه داده).

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
vi.mock("../src/lib/loyalty-sms", () => ({
  fireLoyaltyWelcomeSms: vi.fn(),
  fireLoyaltyTierUpSms: vi.fn(),
  fireLoyaltyReferralSms: vi.fn(),
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../lib/db/migrations");
const DAY = 86_400;

let dbm: typeof import("@workspace/db");
let loyalty: typeof import("../src/lib/loyalty");
let server: http.Server;
let base: string;
let adminId = 0;
let staffUserId = 0;

async function call(method: string, p: string, body?: unknown, userId = adminId) {
  const headers: Record<string, string> = { "x-test-user": String(userId) };
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function setLoyalty(values: Partial<import("../src/lib/loyalty").LoyaltySettings>) {
  const current = await loyalty.getLoyaltySettings();
  const r = await call("PUT", "/loyalty/settings", { ...current, ...values });
  expect(r.status).toBe(200);
}

let fileSeq = 0;
async function patient(name: string, extra: Partial<typeof dbm.patientsTable.$inferInsert> = {}) {
  const [p] = await dbm.db.insert(dbm.patientsTable)
    .values({ name, phone: "09121234567", fileNumber: `MF${++fileSeq}`, ...extra }).returning();
  return p;
}
async function service(body: Record<string, unknown>) {
  const r = await call("POST", "/services", body);
  expect(r.status).toBe(201);
  return r.json;
}
async function appointment(patientId: number, serviceId: number, extra: Record<string, unknown> = {}) {
  const r = await call("POST", "/appointments", { patientId, serviceId, scheduledAt: Date.now(), ...extra });
  expect(r.status).toBe(201);
  return r.json;
}
async function pay(body: Record<string, unknown>) {
  const r = await call("POST", "/payments", { method: "cash", ...body });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json;
}
async function edit(id: number, body: Record<string, unknown>) {
  const r = await call("PUT", `/payments/${id}`, body);
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json;
}
async function del(id: number) {
  const r = await call("DELETE", `/payments/${id}`);
  expect(r.status, JSON.stringify(r.json)).toBe(204);
}
const wallet = (pid: number) => loyalty.getWalletBalance(dbm.db, pid);
const points = (pid: number) => loyalty.getLoyaltyBalance(dbm.db, pid);
const apptRow = async (id: number) => (await dbm.db.select().from(dbm.appointmentsTable).all()).find((a) => a.id === id)!;
const commissionsOf = async (paymentId: number) =>
  (await dbm.db.select().from(dbm.commissionsTable).all()).filter((c) => c.paymentId === paymentId);
const nowSec = () => Math.floor(Date.now() / 1000);

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "money-fixes-test-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-clinic.db");
  dbm = await import("@workspace/db");
  await dbm.runMigrations(MIGRATIONS_DIR);
  loyalty = await import("../src/lib/loyalty");

  const [admin] = await dbm.db.insert(dbm.usersTable)
    .values({ username: "mf-admin", password: "x", role: "admin", permissions: "[]" }).returning();
  const [staff] = await dbm.db.insert(dbm.usersTable)
    .values({ username: "mf-demoted", password: "x", role: "staff", permissions: JSON.stringify(["payments"]) }).returning();
  adminId = admin.id;
  staffUserId = staff.id;

  const app = express();
  app.use(express.json());
  // توکن همیشه ادعای «مدیر» می‌کند؛ نقش واقعی باید از پایگاه داده خوانده شود
  app.use((req, _res, next) => {
    const sub = Number(req.headers["x-test-user"] ?? adminId);
    (req as unknown as { jwtUser: unknown }).jwtUser = { sub, role: "admin", username: "t", permissions: [] };
    next();
  });
  for (const mod of ["payments", "appointments", "services", "accounting", "loyalty", "commissions"]) {
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

describe("B1: points-paid payments", () => {
  it("edit (twice) then delete restores exactly the original points balance", async () => {
    await setLoyalty({ enabled: true, profitRewardPercent: 0, referralBonus: 0, minRedeem: 10, redeemValue: 10_000 });
    try {
      const svc = await service({ name: "امتیازی", price: 1_000_000 });
      const p = await patient("امتیازدار");
      await dbm.db.insert(dbm.loyaltyTransactionsTable).values({ patientId: p.id, delta: 50, amount: 0, type: "adjust", description: "شروع" });
      const a = await appointment(p.id, svc.id);
      const payment = await pay({ appointmentId: a.id, originalAmount: 1_000_000, amount: 800_000, redeemPoints: 20 });
      expect(await points(p.id)).toBe(30);
      await edit(payment.id, { amount: 700_000 });
      expect(await points(p.id)).toBe(30);
      await edit(payment.id, { method: "card" });
      expect(await points(p.id)).toBe(30);
      await del(payment.id);
      expect(await points(p.id)).toBe(50);
    } finally {
      await setLoyalty({ enabled: false });
    }
  });
});

describe("B2/B3/B9: referral credit", () => {
  it("B2: granted when the referred client's first appointment had a deposit", async () => {
    await setLoyalty({ enabled: true, profitRewardPercent: 0, referralBonus: 300_000 });
    try {
      const svc = await service({ name: "معرفی بیعانه", price: 1_000_000 });
      const ref = await patient("معرف بیعانه");
      const friend = await patient("دوست بیعانه", { referrerType: "patient", referrerId: ref.id });
      const a = await appointment(friend.id, svc.id, { deposit: 200_000 });
      await pay({ appointmentId: a.id, originalAmount: 1_000_000, amount: 800_000 });
      expect(await wallet(ref.id)).toBe(300_000);
    } finally {
      await setLoyalty({ enabled: false });
    }
  });

  it("B3: editing the payment that earned a referral keeps the referrer's credit (client has a later payment)", async () => {
    await setLoyalty({ enabled: true, profitRewardPercent: 0, referralBonus: 300_000 });
    try {
      const svc = await service({ name: "معرفی ویرایش", price: 1_000_000 });
      const ref = await patient("معرف ویرایش");
      const friend = await patient("دوست ویرایش", { referrerType: "patient", referrerId: ref.id });
      const first = await pay({ appointmentId: (await appointment(friend.id, svc.id)).id, originalAmount: 1_000_000, amount: 1_000_000 });
      await pay({ appointmentId: (await appointment(friend.id, svc.id)).id, originalAmount: 1_000_000, amount: 1_000_000 });
      expect(await wallet(ref.id)).toBe(300_000);
      await edit(first.id, { amount: 900_000 });
      expect(await wallet(ref.id)).toBe(300_000);
      await del(first.id);
      expect(await wallet(ref.id)).toBe(0);
    } finally {
      await setLoyalty({ enabled: false });
    }
  });

  it("B9: editing after the club was disabled keeps the payment's cashback and referral credit", async () => {
    await setLoyalty({ enabled: true, profitRewardPercent: 5, referralBonus: 300_000 });
    const svc = await service({ name: "باشگاه خاموش", price: 3_000_000, doctorFee: 1_800_000 });
    const ref = await patient("معرف خاموش");
    const friend = await patient("دوست خاموش", { referrerType: "patient", referrerId: ref.id });
    const payment = await pay({ appointmentId: (await appointment(friend.id, svc.id)).id, originalAmount: 3_000_000, amount: 3_000_000 });
    expect(await wallet(friend.id)).toBe(60_000);
    expect(await wallet(ref.id)).toBe(300_000);
    await setLoyalty({ enabled: false });
    await edit(payment.id, { method: "card", amount: 2_900_000 });
    expect(await wallet(friend.id)).toBe(60_000);
    expect(await wallet(ref.id)).toBe(300_000);
  });
});

describe("B4/B5/B13: appointment cashback stays at its target", () => {
  async function setup(name: string) {
    const svc = await service({ name, price: 3_000_000, doctorFee: 1_800_000 });
    const p = await patient(name);
    const a = await appointment(p.id, svc.id);
    const p1 = await pay({ appointmentId: a.id, originalAmount: 3_000_000, amount: 2_000_000 });
    expect(await wallet(p.id)).toBe(10_000);
    const p2 = await pay({ appointmentId: a.id, originalAmount: 3_000_000, amount: 2_000_000 });
    expect(await wallet(p.id)).toBe(110_000);
    const p3 = await pay({ appointmentId: a.id, originalAmount: 3_000_000, amount: 1_000_000 });
    expect(await wallet(p.id)).toBe(160_000);
    await del(p1.id); // پرداخت سوم اصلاحیهٔ منفی می‌گیرد (−۹۰,۰۰۰؛ خالص −۴۰,۰۰۰)
    expect(await wallet(p.id)).toBe(60_000);
    return { p, a, p2, p3 };
  }

  it("B4: deleting a payment that carries a negative correction leaves no over-credit", async () => {
    await setLoyalty({ enabled: true, profitRewardPercent: 5, referralBonus: 0 });
    try {
      const { p, p3 } = await setup("اصلاحیه حذف");
      await del(p3.id);
      // فقط ۲,۰۰۰,۰۰۰ مانده: سود ۲۰۰,۰۰۰ → ۱۰,۰۰۰
      expect(await wallet(p.id)).toBe(10_000);
    } finally {
      await setLoyalty({ enabled: false });
    }
  });

  it("B5: editing a payment that carries a correction does not give the removed excess back", async () => {
    await setLoyalty({ enabled: true, profitRewardPercent: 5, referralBonus: 0 });
    try {
      const { p, p3 } = await setup("اصلاحیه ویرایش");
      await edit(p3.id, { method: "card" });
      expect(await wallet(p.id)).toBe(60_000);
      // افزایش مبلغ: ۳,۲۰۰,۰۰۰ − ۱,۸۰۰,۰۰۰ = ۱,۴۰۰,۰۰۰ → ۷۰,۰۰۰ (همان حذف + ثبت دوباره)
      await edit(p3.id, { amount: 1_200_000 });
      expect(await wallet(p.id)).toBe(70_000);
      await edit(p3.id, { amount: 1_000_000 });
      expect(await wallet(p.id)).toBe(60_000);
    } finally {
      await setLoyalty({ enabled: false });
    }
  });

  it("B13: a later checkout that raises the service cost claws back earlier cashback", async () => {
    await setLoyalty({ enabled: true, profitRewardPercent: 5, referralBonus: 0 });
    try {
      const svc = await service({ name: "واحدی", price: 3_000_000, doctorFee: 100_000, doctorFeeMode: "per_unit" });
      const p = await patient("واحدی");
      const a = await appointment(p.id, svc.id);
      await pay({ appointmentId: a.id, originalAmount: 3_000_000, amount: 3_000_000, unitsUsed: 1 });
      expect(await wallet(p.id)).toBe(145_000);
      await pay({ appointmentId: a.id, originalAmount: 3_100_000, amount: 100_000, unitsUsed: 20 });
      // ۳,۱۰۰,۰۰۰ − ۲,۰۰۰,۰۰۰ = ۱,۱۰۰,۰۰۰ → ۵۵,۰۰۰
      expect(await wallet(p.id)).toBe(55_000);
    } finally {
      await setLoyalty({ enabled: false });
    }
  });
});

describe("B6/B12: appointment price and units after edit/delete", () => {
  it("B6: editing an earlier payment keeps the price set by a later settle-in-full payment", async () => {
    const svc = await service({ name: "قیمت نوبت", price: 3_000_000 });
    const p = await patient("قیمت نوبت");
    const a = await appointment(p.id, svc.id);
    const p1 = await pay({ appointmentId: a.id, originalAmount: 3_000_000, amount: 1_000_000 });
    await pay({ appointmentId: a.id, originalAmount: 3_000_000, amount: 1_500_000, settleInFull: true });
    expect((await call("GET", `/appointments/${a.id}`)).json).toMatchObject({ price: 2_500_000, remaining: 0 });
    await edit(p1.id, { method: "card" });
    expect((await call("GET", `/appointments/${a.id}`)).json).toMatchObject({ price: 2_500_000, remaining: 0 });
  });

  it("B12: units follow the latest checkout; PUT unitsUsed:null clears them", async () => {
    const svc = await service({ name: "واحد نوبت", price: 1_000_000 });
    const p = await patient("واحد نوبت");
    const a = await appointment(p.id, svc.id);
    const p1 = await pay({ appointmentId: a.id, originalAmount: 1_000_000, amount: 500_000, unitsUsed: 5 });
    const p2 = await pay({ appointmentId: a.id, originalAmount: 1_000_000, amount: 500_000, unitsUsed: 3 });
    expect((await apptRow(a.id)).unitsUsed).toBe(3);
    await del(p2.id);
    expect((await apptRow(a.id)).unitsUsed).toBe(5);
    await edit(p1.id, { unitsUsed: null });
    expect((await apptRow(a.id)).unitsUsed).toBeNull();
  });
});

describe("B7/B8/B10: commissions", () => {
  it("B7/B8: auto and manual commissions are dated at the payment's paidAt", async () => {
    const [st] = await dbm.db.insert(dbm.staffTable).values({ name: "کارمند معرف" }).returning();
    const [ext] = await dbm.db.insert(dbm.commissionRecipientsTable).values({ name: "معرف بیرونی" }).returning();
    const svc = await service({ name: "پورسانت تاریخ", price: 1_000_000 });
    const p = await patient("پورسانتی تاریخ", { referrerType: "staff", referrerId: st.id, referrerRate: 10 });
    const a = await appointment(p.id, svc.id);
    const paidAt = nowSec() - 40 * DAY;
    const payment = await pay({
      appointmentId: a.id, originalAmount: 1_000_000, amount: 1_000_000, paidAt,
      manualCommission: { recipientType: "external", recipientId: ext.id, amount: 50_000 },
    });
    let rows = await commissionsOf(payment.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((c) => c.createdAt === paidAt)).toBe(true);

    // ویرایش بدون تغییر تاریخ: تاریخ قبلی کمیسیون (حتی اگر با paidAt فرق داشته باشد) حفظ می‌شود
    const legacy = paidAt + 3600;
    await dbm.db.update(dbm.commissionsTable).set({ createdAt: legacy });
    const uuids = new Map(rows.map((c) => [`${c.recipientType}:${c.recipientId}`, c.uuid]));
    await edit(payment.id, { amount: 900_000 });
    rows = await commissionsOf(payment.id);
    expect(rows).toHaveLength(2);
    expect(rows.every((c) => c.createdAt === legacy)).toBe(true);
    expect(rows.every((c) => uuids.get(`${c.recipientType}:${c.recipientId}`) === c.uuid)).toBe(true);

    // تغییر تاریخ پرداخت: کمیسیون هم به ماه جدید می‌رود
    const newPaidAt = nowSec() - 70 * DAY;
    await edit(payment.id, { paidAt: newPaidAt });
    rows = await commissionsOf(payment.id);
    expect(rows.every((c) => c.createdAt === newPaidAt)).toBe(true);
  });

  it("B10: editing keeps every non-auto commission linked to the payment", async () => {
    const [r1] = await dbm.db.insert(dbm.commissionRecipientsTable).values({ name: "گیرنده یک" }).returning();
    const [r2] = await dbm.db.insert(dbm.commissionRecipientsTable).values({ name: "گیرنده دو" }).returning();
    const svc = await service({ name: "چند کمیسیون", price: 1_000_000 });
    const a = await appointment((await patient("چند کمیسیون")).id, svc.id);
    const payment = await pay({
      appointmentId: a.id, originalAmount: 1_000_000, amount: 1_000_000,
      manualCommission: { recipientType: "external", recipientId: r1.id, amount: 100_000, rate: 10 },
    });
    const c2 = await call("POST", "/commissions", {
      recipientType: "external", recipientId: r2.id, appointmentId: a.id, paymentId: payment.id, amount: 30_000,
    });
    expect(c2.status).toBe(201);
    await edit(payment.id, { amount: 800_000 });
    const rows = (await commissionsOf(payment.id)).sort((x, y) => x.recipientId - y.recipientId);
    expect(rows.map((c) => [c.recipientId, c.amount])).toEqual([[r1.id, 80_000], [r2.id, 30_000]]);
  });
});

describe("ACCT-3: billed factor", () => {
  it("a follow-up payment carrying the discounted price does not lower the service cost", async () => {
    const svc = await service({ name: "پکیج دو جلسه", price: 3_000_000, doctorFee: 1_800_000 });
    const a = await appointment((await patient("پکیجی")).id, svc.id);
    const from = nowSec() - 5;
    const base0 = (await call("GET", `/accounting/summary?from=${from}&to=${nowSec() + 3600}`)).json.serviceCosts;
    await pay({ appointmentId: a.id, originalAmount: 6_000_000, amount: 2_000_000 });
    const after1 = (await call("GET", `/accounting/summary?from=${from}&to=${nowSec() + 3600}`)).json.serviceCosts;
    expect(after1 - base0).toBe(3_600_000);
    await pay({ appointmentId: a.id, originalAmount: 4_000_000, amount: 4_000_000 });
    const after2 = (await call("GET", `/accounting/summary?from=${from}&to=${nowSec() + 3600}`)).json.serviceCosts;
    expect(after2 - base0).toBe(3_600_000);
  });
});

describe("SYS-1/SYS-6/reminder: edit identity, admin check, reminder date", () => {
  it("SYS-1: PUT keeps the payment's uuid", async () => {
    const svc = await service({ name: "شناسه", price: 500_000 });
    const a = await appointment((await patient("شناسه")).id, svc.id);
    const payment = await pay({ appointmentId: a.id, originalAmount: 500_000, amount: 500_000 });
    const edited = await edit(payment.id, { amount: 400_000 });
    expect(edited.uuid).toBe(payment.uuid);
  });

  it("SYS-6: a token claiming admin is refused when the user's DB role is not admin", async () => {
    const svc = await service({ name: "نقش", price: 500_000 });
    const a = await appointment((await patient("نقش")).id, svc.id);
    const payment = await pay({ appointmentId: a.id, originalAmount: 500_000, amount: 500_000 });
    const r = await call("PUT", `/payments/${payment.id}`, { amount: 100 }, staffUserId);
    expect(r.status).toBe(403);
    expect((await call("GET", `/payments/${payment.id}`)).json.amount).toBe(500_000);
  });

  it("rejects a Shamsi-looking or invalid reminder date with a Persian 400", async () => {
    const svc = await service({ name: "یادآوری", price: 500_000 });
    const a = await appointment((await patient("یادآوری")).id, svc.id);
    for (const dueDate of ["1405-08-01", "2026-02-30", "1760000000000", "2026-13-01"]) {
      const r = await call("POST", "/payments", {
        appointmentId: a.id, originalAmount: 500_000, amount: 500_000, method: "cash", reminder: { type: "followup", dueDate },
      });
      expect(r.status, dueDate).toBe(400);
      expect(r.json.error).toMatch(/تاریخ یادآوری/);
    }
    expect((await call("GET", "/payments")).json.filter((x: { appointmentId: number }) => x.appointmentId === a.id)).toHaveLength(0);
  });
});
