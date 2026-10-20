// منطقهٔ زمانی سرور عمداً غیر از تهران است تا وابستگی به وقت محلی سرور آشکار شود
process.env.TZ = "America/New_York";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

// درستی پیامک‌های خودکار: یادآوری تکراری، وقت تهران، رزرو اتمی، ارسالِ نیمه‌کاره،
// تولد دستی/خودکار و سهمیهٔ نظرسنجی. SQLite موقت؛ sendSms با mock جایگزین شده است.

vi.mock("../src/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../src/lib/activity", () => ({ logActivity: vi.fn(async () => {}) }));

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

// sendSms واقعی (داخل fireSurveySms) نباید به پنل واقعی برود
vi.stubGlobal("fetch", ((orig: typeof fetch) => (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("payamak-panel.com")) return Promise.resolve(new Response(JSON.stringify({ RetStatus: 0, Value: "0" })));
  return orig(input, init);
})(globalThis.fetch));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../lib/db/migrations");

let dbm: typeof import("@workspace/db");
let mod: typeof import("../src/lib/scheduled-sms");
let sms: typeof import("../src/lib/sms");
let tt: typeof import("../src/lib/tehran-time");
let orm: typeof import("drizzle-orm");
let server: http.Server;
let base: string;

const MIN = 60_000;
const HOUR = 60 * MIN;
const tehran = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) - 210 * MIN;
const sec = (ms: number) => Math.floor(ms / 1000);

async function setSettings(values: Record<string, string>) {
  for (const [k, v] of Object.entries(values)) await sms.setAppSetting(k, v);
}

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sms-integrity-test-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-clinic.db");
  dbm = await import("@workspace/db");
  await dbm.runMigrations(MIGRATIONS_DIR);
  sms = await import("../src/lib/sms");
  mod = await import("../src/lib/scheduled-sms");
  tt = await import("../src/lib/tehran-time");
  orm = await import("drizzle-orm");
  const { default: smsRouter } = await import("../src/routes/sms");
  const app = express();
  app.use(express.json());
  app.use(smsRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(async () => {
  sent.length = 0;
  const { db } = dbm;
  await db.delete(dbm.scheduledSmsTable);
  await db.delete(dbm.smsLogTable);
  await db.delete(dbm.surveysTable);
  await db.delete(dbm.remindersTable);
  await db.delete(dbm.appointmentsTable);
  await db.delete(dbm.servicesTable);
  await db.delete(dbm.patientsTable);
  await db.delete(dbm.appSettingsTable);
  await setSettings({ sms_username: "u", sms_password: "p", sms_from: "3000" });
});

async function patient(name: string, extra: Partial<typeof dbm.patientsTable.$inferInsert> = {}) {
  const [p] = await dbm.db
    .insert(dbm.patientsTable)
    .values({ name, phone: "09121234567", fileNumber: `F-${name}-${Math.random()}`, ...extra })
    .returning();
  return p;
}

async function appointment(patientId: number, scheduledAtMs: number, createdAtMs: number, status = "scheduled") {
  const [s] = await dbm.db.insert(dbm.servicesTable).values({ name: "بوتاکس", price: 1 }).returning();
  const [a] = await dbm.db
    .insert(dbm.appointmentsTable)
    .values({ patientId, serviceId: s.id, scheduledAt: scheduledAtMs, status, createdAt: sec(createdAtMs) })
    .returning();
  return a;
}

const keyRow = (key: string) =>
  dbm.db.select().from(dbm.scheduledSmsTable).where(orm.eq(dbm.scheduledSmsTable.key, key)).get();

describe("SMS dates and times use Tehran time", () => {
  it("formats in Tehran regardless of the server time zone", () => {
    expect(new Date(tehran(2026, 11, 5, 2)).getDate()).toBe(4); // نیویورک هنوز ۴ نوامبر است
    expect(sms.formatShamsiDateForSms(tehran(2026, 11, 5, 2))).toBe("۱۴ آبان ۱۴۰۵");
    expect(sms.formatTimeForSms(tehran(2026, 11, 5, 2))).toBe("۰۲:۰۰");
    // ورودی ثانیه هم پذیرفته می‌شود
    expect(sms.formatShamsiDateForSms(sec(tehran(2026, 11, 5, 23, 45)))).toBe("۱۴ آبان ۱۴۰۵");
    expect(sms.formatTimeForSms(sec(tehran(2026, 11, 5, 23, 45)))).toBe("۲۳:۴۵");
  });
});

describe("appointment reminder vs. booking confirmation", () => {
  beforeEach(async () => {
    await setSettings({ sms_enabled_appointment_reminder: "true" });
  });

  it("does not remind a same-day booking", async () => {
    const p = await patient("الف");
    await appointment(p.id, tehran(2026, 11, 5, 15), tehran(2026, 11, 5, 9));
    await mod.runScheduledSms(tehran(2026, 11, 5, 9, 10));
    await mod.runScheduledSms(tehran(2026, 11, 5, 12));
    expect(sent).toHaveLength(0);
  });

  it("does not remind a booking made after the reminder window opened", async () => {
    const p = await patient("الف");
    await appointment(p.id, tehran(2026, 11, 5, 11), tehran(2026, 11, 4, 19));
    await mod.runScheduledSms(tehran(2026, 11, 4, 19, 10));
    expect(sent).toHaveLength(0);
  });

  it("still reminds a booking made two days ahead, the day before", async () => {
    const p = await patient("الف");
    await appointment(p.id, tehran(2026, 11, 6, 11), tehran(2026, 11, 4, 10));
    await mod.runScheduledSms(tehran(2026, 11, 4, 10, 10));
    expect(sent).toHaveLength(0);
    await mod.runScheduledSms(tehran(2026, 11, 5, 18, 5));
    expect(sent).toHaveLength(1);
    expect(sent[0].eventType).toBe("appointment_reminder");
  });

  it("skips bookings made less than 3 hours before the appointment", () => {
    const at = tehran(2026, 11, 5, 11);
    expect(mod.skipReminderForLateBooking(at - 2 * HOUR, at, at - 100 * HOUR)).toBe(true);
    expect(mod.skipReminderForLateBooking(at - 48 * HOUR, at, at - 17 * HOUR)).toBe(false);
  });
});

describe("follow-up reminder", () => {
  it("is skipped (and not retried) when the patient already has a future appointment", async () => {
    await setSettings({ sms_enabled_followup_reminder: "true" });
    const booked = await patient("نوبت‌دار");
    const other = await patient("بی‌نوبت");
    for (const p of [booked, other]) {
      await dbm.db.insert(dbm.remindersTable)
        .values({ title: "پیگیری", type: "followup", status: "pending", patientId: p.id, dueAt: sec(tehran(2026, 11, 5, 12)) });
    }
    // نوبت آینده با واحد قدیمیِ ثانیه
    await appointment(booked.id, sec(tehran(2026, 11, 20, 11)), tehran(2026, 11, 1, 10));
    await mod.runScheduledSms(tehran(2026, 11, 5, 11));
    expect(sent).toHaveLength(1);
    expect(sent[0].patientId).toBe(other.id);
    const rows = await dbm.db.select().from(dbm.scheduledSmsTable);
    expect(rows.find((r) => r.status === "skipped")?.key).toMatch(/^followup:/);
    await mod.runScheduledSms(tehran(2026, 11, 5, 15));
    expect(sent).toHaveLength(1);
  });

  it("is sent when the patient's only appointment is in the past", async () => {
    await setSettings({ sms_enabled_followup_reminder: "true" });
    const p = await patient("الف");
    await dbm.db.insert(dbm.remindersTable)
      .values({ title: "پیگیری", type: "followup", status: "pending", patientId: p.id, dueAt: sec(tehran(2026, 11, 5, 12)) });
    await appointment(p.id, tehran(2026, 10, 5, 11), tehran(2026, 10, 1, 10));
    await mod.runScheduledSms(tehran(2026, 11, 5, 11));
    expect(sent).toHaveLength(1);
  });
});

describe("birthday: manual send prevents the automatic one", () => {
  it("marks the upcoming birthday's key so the automatic greeting is not sent again", async () => {
    await setSettings({ sms_enabled_birthday_auto: "true", sms_daily_auto_hour: "0" });
    const now = Date.now();
    const [jy, jm, jd] = tt.tehranShamsi(now);
    const p = await patient("نگار", { birthdate: `1370-${String(jm).padStart(2, "0")}-${String(jd).padStart(2, "0")}` });
    const res = await fetch(`${base}/sms/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "{نام} عزیز تولدت مبارک", patientIds: [p.id], eventType: "birthday" }),
    });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect((await keyRow(`birthday:${p.id}:${jy}`))?.status).toBe("sent");
    expect(await mod.runScheduledSms(now)).toMatchObject({ birthdays: 0 });
    expect(sent).toHaveLength(1);
  });

  it("uses next Shamsi year when this year's birthday has passed", () => {
    const now = tehran(2026, 11, 5, 12); // ۱۴ آبان ۱۴۰۵
    expect(mod.upcomingBirthdayShamsiYear("1370-08-14", now)).toBe(1405);
    expect(mod.upcomingBirthdayShamsiYear("1370-08-13", now)).toBe(1406);
    expect(mod.upcomingBirthdayShamsiYear("1370-12-01", now)).toBe(1405);
  });
});

describe("claiming a scheduled SMS", () => {
  it("is atomic: two concurrent claims, only one wins", async () => {
    const results = await Promise.all([
      mod.claimScheduledSms("test:1", "birthday", 1000),
      mod.claimScheduledSms("test:1", "birthday", 1000),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("keeps the retry rules for failed sends", async () => {
    expect(await mod.claimScheduledSms("test:2", "birthday", 1000)).toBe(true);
    await mod.finishScheduledSms("test:2", false);
    expect(await mod.claimScheduledSms("test:2", "birthday", 1000 + 10 * 60)).toBe(false);
    const again = await Promise.all([
      mod.claimScheduledSms("test:2", "birthday", 1000 + 31 * 60),
      mod.claimScheduledSms("test:2", "birthday", 1000 + 31 * 60),
    ]);
    expect(again.filter(Boolean)).toHaveLength(1);
    expect((await keyRow("test:2"))?.attempts).toBe(2);
  });

  it("does not resend an interrupted send the provider already accepted", async () => {
    await setSettings({ sms_enabled_appointment_reminder: "true" });
    const p = await patient("الف");
    const a = await appointment(p.id, tehran(2026, 11, 5, 23), tehran(2026, 11, 1, 10));
    const t0 = tehran(2026, 11, 4, 18);
    const key = `appointment:${a.id}:${a.scheduledAt}`;
    // برنامه پس از رزرو و ارسال موفق، پیش از ثبت نتیجه بسته شده است
    expect(await mod.claimScheduledSms(key, "appointment_reminder", sec(t0), { patientId: p.id })).toBe(true);
    await dbm.db.insert(dbm.smsLogTable).values({
      recipientPhone: "09121234567", patientId: p.id, eventType: "appointment_reminder",
      message: "یادآوری", status: "sent", createdAt: sec(t0) + 5,
    });
    await mod.runScheduledSms(t0 + 31 * MIN);
    expect(sent).toHaveLength(0);
    expect((await keyRow(key))?.status).toBe("sent");
  });

  it("retries an interrupted send that never reached the provider", async () => {
    await setSettings({ sms_enabled_appointment_reminder: "true" });
    const p = await patient("الف");
    const a = await appointment(p.id, tehran(2026, 11, 5, 23), tehran(2026, 11, 1, 10));
    const t0 = tehran(2026, 11, 4, 18);
    await mod.claimScheduledSms(`appointment:${a.id}:${a.scheduledAt}`, "appointment_reminder", sec(t0), { patientId: p.id });
    await mod.runScheduledSms(t0 + 31 * MIN);
    expect(sent).toHaveLength(1);
  });
});

describe("survey throttle slot", () => {
  async function surveys() {
    // fireSurveySms آتش و فراموش است؛ کمی صبر
    await new Promise((r) => setTimeout(r, 150));
    return dbm.db.select().from(dbm.surveysTable);
  }

  it("is not reserved when the phone is invalid or the panel is not configured", async () => {
    await setSettings({ sms_enabled_survey: "true" });
    const p = await patient("الف", { phone: "021" });
    sms.fireSurveySms({ patientId: p.id, patientName: p.name, phone: "021" });
    expect(await surveys()).toHaveLength(0);

    await setSettings({ sms_password: "" });
    sms.fireSurveySms({ patientId: p.id, patientName: p.name, phone: "09121234567" });
    expect(await surveys()).toHaveLength(0);
  });

  it("is reserved when an SMS can actually be sent", async () => {
    await setSettings({ sms_enabled_survey: "true" });
    const p = await patient("الف");
    sms.fireSurveySms({ patientId: p.id, patientName: p.name, phone: "09121234567" });
    expect(await surveys()).toHaveLength(1);
  });
});
