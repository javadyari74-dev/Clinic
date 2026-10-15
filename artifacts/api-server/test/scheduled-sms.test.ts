import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// پیامک‌های زمان‌بندی‌شده روی SQLite موقت؛ ارسال واقعی با mock جایگزین شده است.

vi.mock("../src/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { sent, sendResult } = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; text: string; eventType: string; pattern?: { bodyId: string; args: string[] } }>,
  sendResult: { ok: true as boolean },
}));

vi.mock("../src/lib/sms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/sms")>();
  return {
    ...actual,
    sendSms: vi.fn(async (input: (typeof sent)[number]) => {
      sent.push(input);
      return sendResult.ok ? { ok: true } : { ok: false, error: "offline" };
    }),
  };
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../lib/db/migrations");

let dbm: typeof import("@workspace/db");
let mod: typeof import("../src/lib/scheduled-sms");
let sms: typeof import("../src/lib/sms");

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// لحظه به وقت تهران (UTC+3:30)
const tehran = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) - 210 * MIN;

async function setSettings(values: Record<string, string>) {
  for (const [k, v] of Object.entries(values)) await sms.setAppSetting(k, v);
}

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scheduled-sms-test-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-clinic.db");
  dbm = await import("@workspace/db");
  await dbm.runMigrations(MIGRATIONS_DIR);
  sms = await import("../src/lib/sms");
  mod = await import("../src/lib/scheduled-sms");
});

beforeEach(async () => {
  sent.length = 0;
  sendResult.ok = true;
  const { db } = dbm;
  await db.delete(dbm.scheduledSmsTable);
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

async function appointment(patientId: number, scheduledAtMs: number, status = "scheduled") {
  const [s] = await dbm.db.insert(dbm.servicesTable).values({ name: "بوتاکس", price: 1 }).returning();
  const [a] = await dbm.db
    .insert(dbm.appointmentsTable)
    .values({ patientId, serviceId: s.id, scheduledAt: scheduledAtMs, status })
    .returning();
  return a;
}

describe("Tehran time helpers", () => {
  it("convert between instants and Tehran wall-clock time", () => {
    const t = tehran(2026, 11, 4, 18, 0);
    expect(mod.tehranParts(t)).toMatchObject({ y: 2026, m: 11, d: 4, hour: 18, minute: 0 });
    expect(mod.tehranInstant(2026, 11, 4, 18)).toBe(t);
  });

  it("opens the appointment reminder window the day before at the chosen hour", () => {
    const appt = tehran(2026, 11, 5, 11, 0);
    expect(mod.appointmentReminderWindow(appt, 18)).toEqual({ from: tehran(2026, 11, 4, 18), until: appt - HOUR });
  });

  it("reads birthdays stored as Gregorian or legacy Shamsi", () => {
    expect(mod.birthShamsiMonthDay("1990-11-05")).toEqual({ m: 8, d: 14 });
    expect(mod.birthShamsiMonthDay("1369-08-14")).toEqual({ m: 8, d: 14 });
    expect(mod.birthShamsiMonthDay("bad")).toBeNull();
  });
});

describe("appointment reminders", () => {
  it("is off by default", async () => {
    const p = await patient("الف");
    await appointment(p.id, tehran(2026, 11, 5, 11));
    expect(await mod.runScheduledSms(tehran(2026, 11, 4, 19))).toMatchObject({ appointmentReminders: 0 });
    expect(sent).toHaveLength(0);
  });

  it("sends once, from the chosen hour the day before, in Tehran time", async () => {
    await setSettings({ sms_enabled_appointment_reminder: "true" });
    const p = await patient("سارا");
    await appointment(p.id, tehran(2026, 11, 5, 11, 30));

    await mod.runScheduledSms(tehran(2026, 11, 4, 17, 59));
    expect(sent).toHaveLength(0);

    await mod.runScheduledSms(tehran(2026, 11, 4, 18, 5));
    expect(sent).toHaveLength(1);
    expect(sent[0].eventType).toBe("appointment_reminder");
    expect(sent[0].text).toContain("سارا");
    expect(sent[0].text).toContain("۱۴ آبان ۱۴۰۵");
    expect(sent[0].text).toContain("۱۱:۳۰");

    await mod.runScheduledSms(tehran(2026, 11, 4, 20));
    await mod.runScheduledSms(tehran(2026, 11, 5, 9));
    expect(sent).toHaveLength(1);
  });

  it("catches up if the app was closed at the scheduled hour, but not within the last hour", async () => {
    await setSettings({ sms_enabled_appointment_reminder: "true" });
    const p = await patient("الف");
    await appointment(p.id, tehran(2026, 11, 5, 11));
    await mod.runScheduledSms(tehran(2026, 11, 5, 10, 30));
    expect(sent).toHaveLength(0);
    await mod.runScheduledSms(tehran(2026, 11, 5, 8));
    expect(sent).toHaveLength(1);
  });

  it("skips cancelled appointments and patients without a valid mobile", async () => {
    await setSettings({ sms_enabled_appointment_reminder: "true" });
    const a = await patient("لغو");
    const b = await patient("بی‌شماره", { phone: "021" });
    await appointment(a.id, tehran(2026, 11, 5, 11), "cancelled");
    await appointment(b.id, tehran(2026, 11, 5, 11));
    await mod.runScheduledSms(tehran(2026, 11, 4, 19));
    expect(sent).toHaveLength(0);
  });

  it("reminds again for the new time when an appointment is moved", async () => {
    await setSettings({ sms_enabled_appointment_reminder: "true" });
    const p = await patient("الف");
    const a = await appointment(p.id, tehran(2026, 11, 5, 11));
    await mod.runScheduledSms(tehran(2026, 11, 4, 19));
    await dbm.db.update(dbm.appointmentsTable).set({ scheduledAt: tehran(2026, 11, 6, 11) })
      .where((await import("drizzle-orm")).eq(dbm.appointmentsTable.id, a.id));
    await mod.runScheduledSms(tehran(2026, 11, 5, 19));
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toContain("۱۵ آبان");
  });

  it("retries a failed send at most 3 times, 30 minutes apart", async () => {
    await setSettings({ sms_enabled_appointment_reminder: "true" });
    const p = await patient("الف");
    await appointment(p.id, tehran(2026, 11, 5, 23));
    sendResult.ok = false;
    const t0 = tehran(2026, 11, 4, 18);
    await mod.runScheduledSms(t0);
    await mod.runScheduledSms(t0 + 10 * MIN);
    expect(sent).toHaveLength(1);
    for (let i = 1; i <= 5; i++) await mod.runScheduledSms(t0 + i * 31 * MIN);
    expect(sent).toHaveLength(mod.MAX_ATTEMPTS);
  });

  it("uses the pattern code and variable order in pattern mode", async () => {
    await setSettings({ sms_enabled_appointment_reminder: "true", sms_send_mode: "pattern", sms_bodyid_appointment_reminder: "777" });
    const p = await patient("الف");
    await appointment(p.id, tehran(2026, 11, 5, 9));
    await mod.runScheduledSms(tehran(2026, 11, 4, 19));
    expect(sent[0].pattern).toEqual({ bodyId: "777", args: ["الف", "۱۴ آبان ۱۴۰۵", "۰۹:۰۰"] });
  });

  it("does nothing without panel credentials", async () => {
    await setSettings({ sms_enabled_appointment_reminder: "true", sms_password: "" });
    const p = await patient("الف");
    await appointment(p.id, tehran(2026, 11, 5, 11));
    await mod.runScheduledSms(tehran(2026, 11, 4, 19));
    expect(sent).toHaveLength(0);
  });
});

describe("follow-up (return) reminders", () => {
  async function reminder(patientId: number, dueAtMs: number, type = "followup", status = "pending") {
    await dbm.db.insert(dbm.remindersTable).values({ title: "پیگیری", type, status, patientId, dueAt: Math.floor(dueAtMs / 1000) });
  }

  it("sends once on the due day from the daily hour", async () => {
    await setSettings({ sms_enabled_followup_reminder: "true" });
    const p = await patient("مریم");
    await reminder(p.id, tehran(2026, 11, 5, 12));
    await mod.runScheduledSms(tehran(2026, 11, 5, 9, 50));
    expect(sent).toHaveLength(0);
    await mod.runScheduledSms(tehran(2026, 11, 5, 10, 5));
    await mod.runScheduledSms(tehran(2026, 11, 5, 15));
    expect(sent).toHaveLength(1);
    expect(sent[0].eventType).toBe("followup_reminder");
    expect(sent[0].text).toContain("مریم");
  });

  it("ignores other reminder types, done reminders and ones older than 3 days", async () => {
    await setSettings({ sms_enabled_followup_reminder: "true" });
    const p = await patient("الف");
    await reminder(p.id, tehran(2026, 11, 5, 12), "payment");
    await reminder(p.id, tehran(2026, 11, 5, 12), "followup", "done");
    await reminder(p.id, tehran(2026, 11, 1, 12));
    await reminder(p.id, tehran(2026, 11, 6, 12));
    await mod.runScheduledSms(tehran(2026, 11, 5, 11));
    expect(sent).toHaveLength(0);
  });
});

describe("birthday greetings", () => {
  it("greets on the Shamsi birthday once a year", async () => {
    await setSettings({ sms_enabled_birthday_auto: "true" });
    await patient("نگار", { birthdate: "1995-11-05" }); // ۱۴ آبان
    await patient("دیگری", { birthdate: "1995-11-06" });
    await mod.runScheduledSms(tehran(2026, 11, 5, 11));
    await mod.runScheduledSms(tehran(2026, 11, 5, 16));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ eventType: "birthday" });
    expect(sent[0].text).toContain("نگار");
    // سال بعد دوباره
    await mod.runScheduledSms(tehran(2027, 11, 5, 11));
    expect(sent).toHaveLength(2);
  });
});
