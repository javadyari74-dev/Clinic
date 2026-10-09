import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

// باشگاه مشتریان سرتاسری: مسیر واقعی پرداخت روی SQLite موقت؛ ارسال پیامک mock شده است.

vi.mock("../src/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { sent } = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; text: string; eventType: string; patientId?: number | null; pattern?: { bodyId: string; args: string[] } }>,
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
const DAY = 86_400;
const MIN = 60_000;

let dbm: typeof import("@workspace/db");
let loyalty: typeof import("../src/lib/loyalty");
let loyaltySms: typeof import("../src/lib/loyalty-sms");
let sms: typeof import("../src/lib/sms");
let server: http.Server;
let base: string;

const tehran = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m - 1, d, h) - 210 * MIN;
// پیامک‌ها «آتش و فراموش»اند؛ صبر می‌کنیم تا تعداد پیامک‌ها ثابت شود
async function settle() {
  let last = -1;
  for (let i = 0; i < 40 && last !== sent.length; i++) {
    last = sent.length;
    await new Promise((r) => setTimeout(r, 60));
  }
}

async function call(method: string, p: string, body?: unknown) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
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
    .values({ name, phone: "09121234567", fileNumber: `F${++fileSeq}`, ...extra }).returning();
  return p;
}

let serviceId = 0;
async function appointment(patientId: number, svc = serviceId) {
  const [a] = await dbm.db.insert(dbm.appointmentsTable)
    .values({ patientId, serviceId: svc, scheduledAt: Date.now(), status: "scheduled" }).returning();
  return a;
}
async function payFor(appointmentId: number, amount: number, extra: Record<string, unknown> = {}) {
  const r = await call("POST", "/payments", { appointmentId, originalAmount: amount, amount, method: "card", ...extra });
  expect(r.status).toBe(201);
  await settle();
  return r.json;
}
async function pay(patientId: number, amount: number, extra: Record<string, unknown> = {}) {
  return payFor((await appointment(patientId)).id, amount, extra);
}
async function lastSmsLog(eventType: string) {
  const { desc, eq } = await import("drizzle-orm");
  return dbm.db.select().from(dbm.smsLogTable)
    .where(eq(dbm.smsLogTable.eventType, eventType)).orderBy(desc(dbm.smsLogTable.id)).get();
}

// موجودی کیف پول (تومان) — پاداش باشگاه اکنون اعتبار سود خدمت در کیف پول است
const wallet = (pid: number) => loyalty.getWalletBalance(dbm.db, pid);
const balance = (pid: number) => loyalty.getLoyaltyBalance(dbm.db, pid);
const member = (pid: number) => dbm.db.select().from(dbm.loyaltyMembersTable)
  .where((require("drizzle-orm") as typeof import("drizzle-orm")).eq(dbm.loyaltyMembersTable.patientId, pid)).get();

// درخواست‌های پنل ملی‌پیامک (از sendSms واقعی، که پیامک پرداخت از آن می‌رود) پاسخ موفق ساختگی می‌گیرند
const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("payamak-panel.com")) {
    return Promise.resolve(new Response(JSON.stringify({ RetStatus: 1, Value: "12345678901", StrRetStatus: "Ok" })));
  }
  return realFetch(input, init);
});

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loyalty-club-test-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-clinic.db");
  dbm = await import("@workspace/db");
  await dbm.runMigrations(MIGRATIONS_DIR);
  loyalty = await import("../src/lib/loyalty");
  loyaltySms = await import("../src/lib/loyalty-sms");
  sms = await import("../src/lib/sms");
  const { default: paymentsRouter } = await import("../src/routes/payments");
  const { default: loyaltyRouter } = await import("../src/routes/loyalty");
  const { default: smsRouter } = await import("../src/routes/sms");
  const { default: patientsRouter } = await import("../src/routes/patients");

  const [svc] = await dbm.db.insert(dbm.servicesTable).values({ name: "بوتاکس", price: 1 }).returning();
  serviceId = svc.id;

  const app = express();
  app.use(express.json());
  app.use(paymentsRouter);
  app.use(loyaltyRouter);
  app.use(smsRouter);
  app.use(patientsRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await sms.setAppSetting("sms_username", "u");
  await sms.setAppSetting("sms_password", "p");
  await sms.setAppSetting("sms_from", "3000");
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  sent.length = 0;
});

describe("membership and profit credit", () => {
  it("adds everyone who already paid when the club is switched on, without SMS or credit", async () => {
    const old = await patient("قدیمی");
    await pay(old.id, 3_000_000); // باشگاه هنوز خاموش است
    expect(await member(old.id)).toBeUndefined();
    sent.length = 0;

    await setLoyalty({
      enabled: true, profitRewardPercent: 5,
      silverMin: 5_000_000, goldMin: 10_000_000, diamondMin: 0, silverRate: 200, goldRate: 300,
    });
    await settle();
    expect(await member(old.id)).toMatchObject({ tier: "bronze", welcomed: true });
    expect(sent.filter((s) => s.eventType === "loyalty_welcome")).toHaveLength(0);
    expect(await wallet(old.id)).toBe(0);
  });

  it("credits 5% of the service profit to the wallet and tells the client in the payment SMS", async () => {
    const p = await patient("سارا");
    await pay(p.id, 10_000_000); // خدمت بدون هزینه → سود ۱۰ میلیون → ۵۰۰ هزار
    // ۱۰ میلیون خرید = مرز طلایی؛ پاداش همین پرداخت با سطح قبلی (برنزی)
    expect(await member(p.id)).toMatchObject({ tier: "gold" });
    expect(await wallet(p.id)).toBe(500_000);
    expect(await balance(p.id)).toBe(0); // امتیاز بر اساس مبلغ دیگر داده نمی‌شود

    const welcome = sent.filter((s) => s.eventType === "loyalty_welcome");
    expect(welcome).toHaveLength(1);
    expect(welcome[0].text).toContain("۵۰۰,۰۰۰ تومان");
    const paymentSms = await lastSmsLog("payment");
    expect(paymentSms?.patientId).toBe(p.id);
    expect(paymentSms?.message).toContain("۵۰۰,۰۰۰ تومان اعتبار هدیه از سود این خدمت");
    expect(paymentSms?.message).toContain("موجودی کیف پول: ۵۰۰,۰۰۰ تومان");

    const history = await call("GET", `/patients/${p.id}/loyalty`);
    expect(history.json).toMatchObject({ walletBalance: 500_000, totalRewards: 500_000 });
    expect(history.json.transactions[0]).toMatchObject({ type: "cashback", amount: 500_000 });
  });

  it("subtracts the service cost and spreads the reward correctly over a deposit and the final payment", async () => {
    const [svc] = await dbm.db.insert(dbm.servicesTable).values({
      name: "فیلر", price: 2_000_000, doctorFee: 400_000, materialCost: 100_000, materialCostMode: "per_unit", unitCount: 2,
    }).returning();
    const p = await patient("بیعانه");
    const a = await appointment(p.id, svc.id);
    await payFor(a.id, 200_000, { notes: "بیعانه" }); // هنوز هزینهٔ ۶۰۰ هزار پوشش داده نشده
    expect(await wallet(p.id)).toBe(0);
    await payFor(a.id, 1_800_000); // جمع ۲ میلیون − ۶۰۰ هزار = ۱.۴ میلیون سود → ۷۰ هزار
    expect(await wallet(p.id)).toBe(70_000);
  });

  it("applies the tier multiplier and announces upgrades", async () => {
    const p = await patient("نگار");
    await pay(p.id, 6_000_000); // عضو تازه (برنزی) → ۵٪ از ۶ میلیون = ۳۰۰ هزار؛ با همین پرداخت نقره‌ای
    expect(await wallet(p.id)).toBe(300_000);
    expect((await member(p.id))?.tier).toBe("silver");

    sent.length = 0;
    await pay(p.id, 1_000_000); // نقره‌ای ×۲ → ۱۰٪ = ۱۰۰ هزار
    expect(await wallet(p.id)).toBe(400_000);

    sent.length = 0;
    await pay(p.id, 4_000_000); // جمع ۱۱ میلیون → طلایی؛ این پرداخت هنوز با نرخ نقره‌ای
    expect(await wallet(p.id)).toBe(800_000);
    expect((await member(p.id))?.tier).toBe("gold");
    const tierUp = sent.filter((s) => s.eventType === "loyalty_tier_up");
    expect(tierUp).toHaveLength(1);
    expect(tierUp[0].text).toContain("طلایی");
  });

  it("spending wallet credit at checkout earns no credit on the wallet-paid part", async () => {
    const p = await patient("کیف");
    await pay(p.id, 2_000_000); // ۱۰۰ هزار اعتبار
    expect(await wallet(p.id)).toBe(100_000);
    // ۱ میلیون خدمت: ۱۰۰ هزار از کیف پول، ۹۰۰ هزار نقد
    await pay(p.id, 900_000, { originalAmount: 1_000_000, applyAccountBalance: 100_000 });
    expect(await wallet(p.id)).toBe(45_000); // ۱۰۰ − ۱۰۰ + ۵٪ × ۹۰۰ هزار
  });

  it("deleting a payment takes its credit back, unless the credit was already spent", async () => {
    const p = await patient("حذف");
    const first = await pay(p.id, 4_000_000);
    expect(await wallet(p.id)).toBe(200_000);
    const del = await call("DELETE", `/payments/${first.id}`);
    expect(del.status).toBe(204);
    expect(await wallet(p.id)).toBe(0);

    const second = await pay(p.id, 4_000_000);
    await pay(p.id, 800_000, { originalAmount: 1_000_000, applyAccountBalance: 200_000 });
    const blocked = await call("DELETE", `/payments/${second.id}`);
    expect(blocked.status).toBe(400);
    expect(blocked.json.error).toContain("خرج شده");
  });

  it("gives the referrer wallet credit once, on the referred client's first payment", async () => {
    await setLoyalty({ referralBonus: 300_000 });
    const a = await patient("معرف");
    await pay(a.id, 1_000_000);
    const before = await wallet(a.id);
    const b = await patient("دوست", { referrerType: "patient", referrerId: a.id });

    sent.length = 0;
    const first = await pay(b.id, 500_000);
    expect(await wallet(a.id)).toBe(before + 300_000);
    const ref = sent.filter((s) => s.eventType === "loyalty_referral");
    expect(ref).toHaveLength(1);
    expect(ref[0].patientId).toBe(a.id);
    expect(ref[0].text).toContain("۳۰۰,۰۰۰ تومان");

    await pay(b.id, 500_000);
    expect(await wallet(a.id)).toBe(before + 300_000);

    expect((await call("DELETE", `/payments/${first.id}`)).status).toBe(204);
    expect(await wallet(a.id)).toBe(before);
  });

  it("adjusts wallet credit manually (admin-only route)", async () => {
    const p = await patient("دستی");
    await pay(p.id, 1_000_000);
    // مسیر فقط برای مدیر است (این سرور تست توکنی ندارد)
    expect((await call("POST", "/loyalty/adjust", { patientId: p.id, amount: 150_000 })).status).toBe(401);
    expect(await loyalty.adjustLoyaltyPoints(p.id, 150_000, "جبران")).toBe(50_000 + 150_000);
    expect(await wallet(p.id)).toBe(200_000);
    await expect(loyalty.adjustLoyaltyPoints(p.id, -999_000, "")).rejects.toThrow(loyalty.LOYALTY_ERRORS.insufficient);
  });
});

describe("expiry of reward credit", () => {
  it("consumes the oldest lots first and lets a reversed earn come out of its own lot", () => {
    const txns = [
      { id: 1, delta: 10, type: "earn", paymentId: 1, createdAt: 1000 },
      { id: 2, delta: 20, type: "earn", paymentId: 2, createdAt: 2000 },
      { id: 3, delta: -15, type: "redeem", paymentId: 3, createdAt: 3000 },
      { id: 4, delta: -5, type: "reverse", paymentId: 2, createdAt: 4000 },
    ];
    expect(loyalty.remainingLots(txns, 12)).toEqual([{ lotId: 2, remaining: 10, expiresAt: 2000 + 12 * 30 * DAY }]);
  });

  it("expires only unspent gift credit after the configured months (never the client's own deposits) and warns 7 days before", async () => {
    await setLoyalty({ expiryMonths: 6 });
    const p = await patient("انقضا");
    const now = Math.floor(Date.now() / 1000);
    await dbm.db.transaction(async (tx) => {
      // پول خود مراجع (شارژ) — هرگز منقضی نمی‌شود
      await loyalty.creditWallet(tx, p.id, 1_000_000, "charge", "شارژ", null, now - 400 * DAY);
      // اعتبار هدیهٔ قدیمی که امروز منقضی شده، و یکی که ۵ روز دیگر منقضی می‌شود
      await loyalty.creditWallet(tx, p.id, 50_000, "loyalty_cashback", "قدیمی", null, now - 6 * 30 * DAY - DAY);
      await loyalty.creditWallet(tx, p.id, 80_000, "loyalty_cashback", "نزدیک", null, now - 6 * 30 * DAY + 5 * DAY);
    });
    await dbm.db.insert(dbm.loyaltyMembersTable).values({ patientId: p.id, joinedAt: now }).onConflictDoNothing();

    expect(await loyalty.expireLoyaltyPoints(now, await loyalty.getLoyaltySettings())).toBe(50_000);
    expect(await wallet(p.id)).toBe(1_000_000 + 80_000);

    sent.length = 0;
    await sms.setAppSetting("loyalty_daily_last_run", "");
    const nowMs = Date.now();
    const atNoon = Math.max(nowMs, tehran(2026, 1, 1) + Math.floor((nowMs - tehran(2026, 1, 1)) / (DAY * 1000)) * DAY * 1000 + 12 * 3600_000);
    await loyaltySms.runLoyaltyDaily(atNoon);
    const warn = sent.filter((s) => s.eventType === "loyalty_expiry" && s.patientId === p.id);
    expect(warn).toHaveLength(1);
    expect(warn[0].text).toContain("۸۰,۰۰۰ تومان");
    await loyaltySms.runLoyaltyDaily(atNoon + 3600_000);
    expect(sent.filter((s) => s.eventType === "loyalty_expiry" && s.patientId === p.id)).toHaveLength(1);
    await setLoyalty({ expiryMonths: 0 });
  });
});

describe("birthday gift and bulk SMS", () => {
  it("adds birthday credit to the wallet once a year and mentions it in the greeting", async () => {
    await setLoyalty({ birthdayBonus: 250_000 });
    await sms.setAppSetting("sms_enabled_birthday_auto", "true");
    const nowMs = Date.now();
    const t = new Date(nowMs + 210 * MIN);
    const birth = `1990-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
    const p = await patient("تولد", { birthdate: birth });
    await pay(p.id, 100_000);
    const start = await wallet(p.id);

    await sms.setAppSetting("loyalty_daily_last_run", "");
    const r = await loyaltySms.runLoyaltyDaily(nowMs);
    expect(r.birthdays).toBeGreaterThanOrEqual(1);
    expect(await wallet(p.id)).toBe(start + 250_000);
    expect(await loyalty.grantBirthdayBonus(p.id, Math.floor(nowMs / 1000), await loyalty.getLoyaltySettings())).toBe(0);

    sent.length = 0;
    const { runScheduledSms } = await import("../src/lib/scheduled-sms");
    const evening = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 20) - 210 * MIN;
    await runScheduledSms(Math.max(evening, nowMs));
    const greet = sent.find((s) => s.eventType === "birthday" && s.patientId === p.id);
    expect(greet?.text).toContain("۲۵۰,۰۰۰ تومان اعتبار هدیه");
    await sms.setAppSetting("sms_enabled_birthday_auto", "false");
  });

  it("sends to club members of the chosen tiers with their wallet credit and tier", async () => {
    const r = await call("POST", "/sms/send", { message: "{نام} عزیز، سطح {سطح} و اعتبار {اعتبار} تومان", loyaltyTiers: ["gold"] });
    expect(r.status).toBe(200);
    const bulk = sent.filter((s) => s.eventType === "loyalty_bulk");
    expect(bulk.length).toBe(r.json.total);
    expect(bulk.length).toBeGreaterThanOrEqual(1);
    expect(bulk.every((s) => s.text.includes("سطح طلایی"))).toBe(true);
    expect(bulk.some((s) => s.text.includes("اعتبار ۸۰۰,۰۰۰ تومان"))).toBe(true);
  });

  it("lists members with wallet credit through the API", async () => {
    const list = await call("GET", "/loyalty/members");
    expect(list.status).toBe(200);
    const negar = list.json.find((m: { patientName: string }) => m.patientName === "نگار");
    expect(negar).toMatchObject({ tier: "gold", walletBalance: 800_000, totalRewards: 800_000 });
    const overview = await call("GET", "/loyalty/overview");
    expect(overview.json.totalMembers).toBe(list.json.length);
    expect(overview.json.totalRewards).toBeGreaterThanOrEqual(800_000);
    expect(overview.json.walletTotal).toBeGreaterThan(0);
  });
});

describe("wallet and checkout stay in step", () => {
  const smallSvc = async (cost: number) => {
    const [svc] = await dbm.db.insert(dbm.servicesTable).values({ name: "خدمت آزمایشی", price: 1, doctorFee: cost }).returning();
    return svc.id;
  };

  it("records a fully wallet-paid service as zero cash, keeps the wallet part on the payment, and earns nothing", async () => {
    const p = await patient("تمام‌کیف");
    await pay(p.id, 2_000_000); // ۱۰۰ هزار اعتبار
    const r = await pay(p.id, 0, { originalAmount: 100_000, applyAccountBalance: 100_000 });
    expect(r).toMatchObject({ amount: 0, originalAmount: 100_000, walletAmount: 100_000 });
    expect(await wallet(p.id)).toBe(0);
    const stored = await call("GET", `/payments/${r.id}`);
    expect(stored.json.walletAmount).toBe(100_000);
  });

  it("rejects paying more from the wallet than the service costs, or a negative amount", async () => {
    const p = await patient("بیش‌از‌حد");
    await pay(p.id, 4_000_000); // ۲۰۰ هزار اعتبار
    const a = await appointment(p.id);
    const tooMuch = await call("POST", "/payments", { appointmentId: a.id, originalAmount: 100_000, amount: 0, method: "card", applyAccountBalance: 150_000 });
    expect(tooMuch.status).toBe(400);
    const negative = await call("POST", "/payments", { appointmentId: a.id, originalAmount: 100_000, amount: -5, method: "card" });
    expect(negative.status).toBe(400);
    expect(await wallet(p.id)).toBe(200_000);
  });

  it("deleting a deposit takes back the extra credit the final payment got because of it", async () => {
    const svc = await smallSvc(600_000);
    const p = await patient("حذف‌بیعانه");
    const a = await appointment(p.id, svc);
    const deposit = await payFor(a.id, 200_000);
    const final = await payFor(a.id, 1_800_000); // (۲ م − ۶۰۰ ه) × ۵٪ = ۷۰ هزار
    expect(await wallet(p.id)).toBe(70_000);

    expect((await call("DELETE", `/payments/${deposit.id}`)).status).toBe(204);
    expect(await wallet(p.id)).toBe(60_000); // (۱.۸ م − ۶۰۰ ه) × ۵٪
    const history = await call("GET", `/patients/${p.id}/loyalty`);
    expect(history.json.totalRewards).toBe(60_000);

    // پرداخت بعدی همان نوبت دقیقاً تا هدف جدید اعتبار می‌دهد
    const again = await payFor(a.id, 200_000);
    expect(await wallet(p.id)).toBe(70_000);

    // حذف همهٔ پرداخت‌ها کیف پول را صفر می‌کند
    expect((await call("DELETE", `/payments/${again.id}`)).status).toBe(204);
    expect((await call("DELETE", `/payments/${final.id}`)).status).toBe(204);
    expect(await wallet(p.id)).toBe(0);
    expect((await call("GET", `/patients/${p.id}/loyalty`)).json.totalRewards).toBe(0);
  });

  it("refuses to delete a deposit when the extra credit was already spent", async () => {
    const p = await patient("خرج‌شده");
    const a = await appointment(p.id);
    const deposit = await payFor(a.id, 1_000_000);
    await payFor(a.id, 1_000_000); // ۱۰۰ هزار کل
    await pay(p.id, 900_000, { originalAmount: 1_000_000, applyAccountBalance: 100_000 });
    const blocked = await call("DELETE", `/payments/${deposit.id}`);
    expect(blocked.status).toBe(400);
    expect(blocked.json.error).toContain("خرج شده");
  });

  it("stores a manual deduction as negative in the club history", async () => {
    const p = await patient("کسر");
    await pay(p.id, 2_000_000);
    await loyalty.adjustLoyaltyPoints(p.id, -40_000, "");
    const history = await call("GET", `/patients/${p.id}/loyalty`);
    expect(history.json.transactions[0]).toMatchObject({ type: "adjust", amount: -40_000 });
    expect(history.json.walletBalance).toBe(60_000);
  });

  it("changes the wallet only through its ledger", async () => {
    const p = await patient("دفتر");
    const edit = await call("PUT", `/patients/${p.id}`, { accountBalance: 9_999_999, notes: "x" });
    expect(edit.status).toBe(200);
    expect(await wallet(p.id)).toBe(0);
    const created = await call("POST", "/patients", { fileNumber: "LEDGER-1", name: "جدید", phone: "09120000000", accountBalance: 500 });
    expect(created.status).toBe(201);
    expect(await wallet(created.json.id)).toBe(0);

    const reserved = await call("POST", `/patients/${p.id}/account-transactions`, { amount: 1000, type: "loyalty_cashback" });
    expect(reserved.status).toBe(400);
    const charge = await call("POST", `/patients/${p.id}/account-transactions`, { amount: 50_000, type: "referral_credit" });
    expect(charge.status).toBe(201);
    const over = await call("POST", `/patients/${p.id}/account-transactions`, { amount: 60_000, type: "deduct" });
    expect(over.status).toBe(400);
    expect(await wallet(p.id)).toBe(50_000);
  });

  it("every wallet balance equals the sum of its transactions", async () => {
    const rows = await dbm.db.all<{ id: number; balance: number; ledger: number }>(
      (await import("drizzle-orm")).sql`
        SELECT p.id AS id, p.account_balance AS balance,
          (SELECT COALESCE(SUM(t.amount), 0) FROM patient_account_transactions t WHERE t.patient_id = p.id) AS ledger
        FROM patients p`,
    );
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.filter((r) => Number(r.balance) !== Number(r.ledger))).toEqual([]);
  });
});

describe("manual club messages", () => {
  it("previews and sends a ready message with each member's wallet and expiring credit", async () => {
    await setLoyalty({ expiryMonths: 6 });
    const p = await patient("ملکی");
    await pay(p.id, 4_000_000); // ۲۰۰ هزار اعتبار (تازه)
    // ۸۰ هزار اعتبار هدیهٔ قدیمی که ۱۰ روز دیگر منقضی می‌شود
    const sixMonths = 6 * 30 * DAY;
    const old = Math.floor(Date.now() / 1000) - sixMonths + 10 * DAY;
    await dbm.db.transaction((tx) => loyalty.creditWallet(tx, p.id, 80_000, "loyalty_birthday", "هدیه قدیمی", null, old));
    expect(await wallet(p.id)).toBe(280_000);

    const message = "{نام} عزیز، موجودی {موجودی} تومان؛ {مبلغ_انقضا} تومان تا {تاریخ_انقضا} منقضی می‌شود.";
    const preview = await call("POST", "/loyalty/notify", { message, patientIds: [p.id], dryRun: true });
    expect(preview.status).toBe(200);
    expect(preview.json).toMatchObject({ total: 1, sent: 0 });
    const r = preview.json.recipients[0];
    expect(r).toMatchObject({ patientId: p.id, balance: 280_000, expiringAmount: 80_000 });
    expect(r.text).toContain("ملکی عزیز، موجودی ۲۸۰,۰۰۰ تومان؛ ۸۰,۰۰۰ تومان تا");
    expect(r.text).not.toContain("{");
    expect(sent.filter((s) => s.eventType === "loyalty_bulk")).toHaveLength(0);

    const send = await call("POST", "/loyalty/notify", { message, patientIds: [p.id] });
    expect(send.json).toMatchObject({ total: 1, sent: 1, failed: 0 });
    const msg = sent.find((s) => s.eventType === "loyalty_bulk" && s.patientId === p.id);
    expect(msg?.text).toBe(r.text);
    await setLoyalty({ expiryMonths: 0 });
  });

  it("sends to all members with filters, and uses the club pattern in service-line mode", async () => {
    const empty = await patient("بی‌موجودی");
    await dbm.db.insert(dbm.loyaltyMembersTable).values({ patientId: empty.id, tier: "bronze", joinedAt: 1, tierUpdatedAt: 1, welcomed: true });

    const all = await call("POST", "/loyalty/notify", { message: "{نام}: {موجودی}", dryRun: true });
    const withBalance = await call("POST", "/loyalty/notify", { message: "{نام}: {موجودی}", onlyWithBalance: true, dryRun: true });
    expect(all.json.total).toBeGreaterThan(withBalance.json.total);
    expect(withBalance.json.recipients.every((r: { balance: number }) => r.balance > 0)).toBe(true);
    const gold = await call("POST", "/loyalty/notify", { message: "x", tiers: ["gold"], dryRun: true });
    const goldMembers = (await call("GET", "/loyalty/members")).json.filter((m: { tier: string }) => m.tier === "gold");
    expect(gold.json.total).toBe(goldMembers.length);
    // هیچ عضوی اعتبار در حال انقضا ندارد (انقضا خاموش است) → ارسال رد می‌شود
    const none = await call("POST", "/loyalty/notify", { message: "x", onlyExpiring: true });
    expect(none.status).toBe(400);

    await sms.setAppSetting("sms_send_mode", "pattern");
    await sms.setAppSetting("sms_bodyid_loyalty_notify", "777");
    try {
      const p = await patient("پترنی");
      await pay(p.id, 2_000_000);
      sent.length = 0;
      const r = await call("POST", "/loyalty/notify", { message: "متن آزاد", patientIds: [p.id] });
      expect(r.json).toMatchObject({ sent: 1, usesPattern: true });
      expect(sent[0].pattern).toEqual({ bodyId: "777", args: ["پترنی", "۱۰۰,۰۰۰", "۰", "—"] });
    } finally {
      await sms.setAppSetting("sms_send_mode", "normal");
      await sms.setAppSetting("sms_bodyid_loyalty_notify", "");
    }
  });
});
