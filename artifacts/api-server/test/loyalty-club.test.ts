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
async function pay(patientId: number, amount: number, extra: Record<string, unknown> = {}) {
  const [a] = await dbm.db.insert(dbm.appointmentsTable)
    .values({ patientId, serviceId, scheduledAt: Date.now(), status: "scheduled" }).returning();
  const r = await call("POST", "/payments", { appointmentId: a.id, originalAmount: amount, amount, method: "card", ...extra });
  expect(r.status).toBe(201);
  await settle();
  return r.json;
}

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

  const [svc] = await dbm.db.insert(dbm.servicesTable).values({ name: "بوتاکس", price: 1 }).returning();
  serviceId = svc.id;

  const app = express();
  app.use(express.json());
  app.use(paymentsRouter);
  app.use(loyaltyRouter);
  app.use(smsRouter);
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

describe("membership", () => {
  it("adds everyone who already paid when the club is switched on, without SMS", async () => {
    const old = await patient("قدیمی");
    await pay(old.id, 3_000_000); // باشگاه هنوز خاموش است
    expect(await member(old.id)).toBeUndefined();
    sent.length = 0;

    await setLoyalty({ enabled: true, silverMin: 5_000_000, goldMin: 10_000_000, diamondMin: 0, silverRate: 200 });
    await settle();
    const m = await member(old.id);
    expect(m).toMatchObject({ tier: "bronze", welcomed: true });
    expect(sent.filter((s) => s.eventType === "loyalty_welcome")).toHaveLength(0);
  });

  it("joins a new client on their first payment, with one welcome SMS and points in the payment SMS", async () => {
    const p = await patient("سارا");
    await pay(p.id, 1_000_000);
    expect(await member(p.id)).toMatchObject({ tier: "bronze" });
    expect(await balance(p.id)).toBe(10);

    const welcome = sent.filter((s) => s.eventType === "loyalty_welcome");
    expect(welcome).toHaveLength(1);
    expect(welcome[0].text).toContain("سارا");
    // پیامک پرداخت از داخل خود ماژول sms فرستاده می‌شود (mock بالا آن را نمی‌گیرد)؛
    // متنش را از تاریخچهٔ پیامک می‌خوانیم
    const { desc, eq } = await import("drizzle-orm");
    const paymentSms = await dbm.db.select().from(dbm.smsLogTable)
      .where(eq(dbm.smsLogTable.eventType, "payment")).orderBy(desc(dbm.smsLogTable.id)).get();
    expect(paymentSms?.patientId).toBe(p.id);
    expect(paymentSms?.message).toContain("امتیاز این خرید: ۱۰");
    expect(paymentSms?.message).toContain("موجودی باشگاه: ۱۰ امتیاز");

    sent.length = 0;
    await pay(p.id, 1_000_000);
    expect(sent.filter((s) => s.eventType === "loyalty_welcome")).toHaveLength(0);
  });

  it("upgrades the tier with an SMS and applies the tier multiplier to later payments", async () => {
    const p = await patient("نگار");
    await pay(p.id, 6_000_000); // عبور از مرز نقره‌ای (۵ میلیون) با همین پرداخت
    expect((await member(p.id))?.tier).toBe("silver");
    // امتیاز همین پرداخت با سطح قبلی (برنزی) حساب می‌شود
    expect(await balance(p.id)).toBe(60);
    const up = sent.filter((s) => s.eventType === "loyalty_tier_up");
    // عضو تازه: خوش‌آمد می‌گیرد، نه پیامک ارتقا
    expect(up).toHaveLength(0);

    sent.length = 0;
    await pay(p.id, 1_000_000); // نقره‌ای: ضریب ۲۰۰٪
    expect(await balance(p.id)).toBe(60 + 20);

    sent.length = 0;
    await pay(p.id, 4_000_000); // جمع ۱۱ میلیون → طلایی
    expect((await member(p.id))?.tier).toBe("gold");
    const tierUp = sent.filter((s) => s.eventType === "loyalty_tier_up");
    expect(tierUp).toHaveLength(1);
    expect(tierUp[0].text).toContain("طلایی");
  });

  it("gives the referrer points once, on the referred client's first payment, and reverses them if that payment is deleted", async () => {
    await setLoyalty({ referralBonus: 30 });
    const a = await patient("معرف");
    await pay(a.id, 1_000_000);
    const before = await balance(a.id);
    const b = await patient("دوست", { referrerType: "patient", referrerId: a.id });

    sent.length = 0;
    const first = await pay(b.id, 500_000);
    expect(await balance(a.id)).toBe(before + 30);
    const ref = sent.filter((s) => s.eventType === "loyalty_referral");
    expect(ref).toHaveLength(1);
    expect(ref[0].patientId).toBe(a.id);

    await pay(b.id, 500_000);
    expect(await balance(a.id)).toBe(before + 30);

    const del = await call("DELETE", `/payments/${first.id}`);
    expect([200, 204]).toContain(del.status);
    expect(await balance(a.id)).toBe(before);
  });
});

describe("expiry", () => {
  it("consumes the oldest points first and lets a reversed earn come out of its own lot", () => {
    const txns = [
      { id: 1, delta: 10, type: "earn", paymentId: 1, createdAt: 1000 },
      { id: 2, delta: 20, type: "earn", paymentId: 2, createdAt: 2000 },
      { id: 3, delta: -15, type: "redeem", paymentId: 3, createdAt: 3000 },
      { id: 4, delta: -5, type: "reverse", paymentId: 2, createdAt: 4000 },
    ];
    const lots = loyalty.remainingLots(txns, 12);
    expect(lots).toEqual([{ lotId: 2, remaining: 10, expiresAt: 2000 + 12 * 30 * DAY }]);
  });

  it("expires unused points after the configured months and warns 7 days before, once", async () => {
    await setLoyalty({ expiryMonths: 6 });
    const p = await patient("انقضا");
    await pay(p.id, 1_000_000);
    const now = Math.floor(Date.now() / 1000);
    // ۱۰ امتیاز قدیمی که ۵ روز دیگر منقضی می‌شود، و ۵ امتیاز که امروز منقضی شده
    await dbm.db.insert(dbm.loyaltyTransactionsTable).values([
      { patientId: p.id, delta: 10, type: "adjust", amount: 0, createdAt: now - 6 * 30 * DAY + 5 * DAY },
      { patientId: p.id, delta: 5, type: "adjust", amount: 0, createdAt: now - 6 * 30 * DAY - DAY },
    ]);
    const start = await balance(p.id);
    expect(await loyalty.expireLoyaltyPoints(now, await loyalty.getLoyaltySettings())).toBeGreaterThanOrEqual(5);
    expect(await balance(p.id)).toBe(start - 5);

    sent.length = 0;
    await sms.setAppSetting("loyalty_daily_last_run", "");
    const nowMs = Date.now();
    const atNoon = tehran(2026, 1, 1) + (Math.floor((nowMs - tehran(2026, 1, 1)) / (DAY * 1000)) * DAY * 1000) + 12 * 3600_000;
    await loyaltySms.runLoyaltyDaily(Math.max(atNoon, nowMs));
    const warn = sent.filter((s) => s.eventType === "loyalty_expiry" && s.patientId === p.id);
    expect(warn).toHaveLength(1);
    expect(warn[0].text).toContain("۱۰ امتیاز");
    await loyaltySms.runLoyaltyDaily(Math.max(atNoon, nowMs) + 3600_000);
    expect(sent.filter((s) => s.eventType === "loyalty_expiry" && s.patientId === p.id)).toHaveLength(1);
    await setLoyalty({ expiryMonths: 0 });
  });
});

describe("birthday gift and bulk SMS", () => {
  it("gives birthday points once a year and mentions them in the birthday greeting", async () => {
    await setLoyalty({ birthdayBonus: 25 });
    await sms.setAppSetting("sms_enabled_birthday_auto", "true");
    // تولد امروز (به وقت تهران)
    const nowMs = Date.now();
    const t = new Date(nowMs + 210 * MIN);
    const birth = `1990-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
    const p = await patient("تولد", { birthdate: birth });
    await pay(p.id, 100_000);
    const start = await balance(p.id);

    await sms.setAppSetting("loyalty_daily_last_run", "");
    const r = await loyaltySms.runLoyaltyDaily(nowMs);
    expect(r.birthdays).toBeGreaterThanOrEqual(1);
    expect(await balance(p.id)).toBe(start + 25);
    expect(await loyalty.grantBirthdayBonus(p.id, Math.floor(nowMs / 1000), await loyalty.getLoyaltySettings())).toBe(0);

    sent.length = 0;
    const { runScheduledSms } = await import("../src/lib/scheduled-sms");
    const t10 = new Date(nowMs + 210 * MIN);
    const evening = Date.UTC(t10.getUTCFullYear(), t10.getUTCMonth(), t10.getUTCDate(), 20) - 210 * MIN;
    await runScheduledSms(Math.max(evening, nowMs));
    const greet = sent.find((s) => s.eventType === "birthday" && s.patientId === p.id);
    expect(greet?.text).toContain("۲۵ امتیاز هدیه");
    await sms.setAppSetting("sms_enabled_birthday_auto", "false");
  });

  it("sends to club members of the chosen tiers with personal points and tier", async () => {
    const r = await call("POST", "/sms/send", { message: "{نام} عزیز، سطح {سطح} و {امتیاز} امتیاز", loyaltyTiers: ["gold"] });
    expect(r.status).toBe(200);
    const bulk = sent.filter((s) => s.eventType === "loyalty_bulk");
    expect(bulk.length).toBe(r.json.total);
    expect(bulk.length).toBeGreaterThanOrEqual(1);
    expect(bulk.every((s) => s.text.includes("سطح طلایی"))).toBe(true);

    sent.length = 0;
    const all = await call("POST", "/sms/send", { message: "سلام {نام}", loyaltyTiers: [] });
    const members = await dbm.db.select().from(dbm.loyaltyMembersTable);
    expect(all.json.total).toBe(members.length);
  });

  it("lists members and their state through the API", async () => {
    const list = await call("GET", "/loyalty/members");
    expect(list.status).toBe(200);
    const gold = list.json.find((m: { tier: string }) => m.tier === "gold");
    expect(gold).toMatchObject({ patientName: "نگار" });
    const one = await call("GET", `/patients/${gold.patientId}/loyalty`);
    expect(one.json.member).toMatchObject({ tier: "gold" });
    expect(one.json.member.nextTier).toBeNull(); // الماسی غیرفعال (۰)

    const overview = await call("GET", "/loyalty/overview");
    expect(overview.json.membersByTier.gold).toBeGreaterThanOrEqual(1);
    expect(overview.json.totalMembers).toBe(list.json.length);
  });
});
