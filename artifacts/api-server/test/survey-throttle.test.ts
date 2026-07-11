import { beforeEach, describe, expect, it, vi } from "vitest";

// این تست برخلاف بقیه تست‌ها از mock زنجیره‌ای استفاده نمی‌کند: برای اثبات
// اتمی بودن «رزرو سهمیه نظرسنجی» (reserveSurveySlot) به یک SQLite واقعی نیاز
// داریم تا دو فراخوانی هم‌زمان واقعاً روی یک جدول رقابت کنند. بانک در حافظه
// (:memory:) ساخته می‌شود و schema واقعی از @workspace/db/schema می‌آید
// (import مستقیم index.ts ممنوع است چون همان لحظه clinic.db را باز می‌کند).
vi.mock("@workspace/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schema = await import("@workspace/db/schema");
  const client = createClient({ url: ":memory:" });
  // همان DDL مهاجرت 0016
  await client.execute(`CREATE TABLE surveys (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    uuid text NOT NULL,
    patient_id integer NOT NULL,
    appointment_id integer,
    payment_id integer,
    service_id integer,
    staff_id integer,
    sent_at integer NOT NULL,
    sms_status text DEFAULT 'pending' NOT NULL,
    score integer,
    comment text,
    scored_at integer,
    created_at integer DEFAULT 0 NOT NULL
  )`);
  await client.execute(`CREATE UNIQUE INDEX surveys_uuid_unique ON surveys (uuid)`);
  await client.execute(`CREATE INDEX surveys_patient_id_idx ON surveys (patient_id)`);
  await client.execute(`CREATE INDEX surveys_sent_at_idx ON surveys (sent_at)`);
  return { ...schema, db: drizzle(client, { schema }) };
});

import { reserveSurveySlot } from "../src/lib/sms";
import { db, surveysTable } from "@workspace/db";

const NOW = 1_800_000_000; // ثانیه یونیکس

function slotArgs(overrides: Partial<Parameters<typeof reserveSurveySlot>[0]> = {}) {
  return {
    patientId: 1,
    appointmentId: null,
    paymentId: null,
    serviceId: null,
    staffId: null,
    now: NOW,
    throttleDays: 30,
    ...overrides,
  };
}

describe("reserveSurveySlot (رزرو اتمی سهمیه نظرسنجی)", () => {
  beforeEach(async () => {
    await db.delete(surveysTable);
  });

  it("از چند فراخوانی هم‌زمان برای یک بیمار فقط یکی ردیف می‌سازد", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => reserveSurveySlot(slotArgs())),
    );
    const granted = results.filter((id) => id != null);
    expect(granted).toHaveLength(1);

    const rows = await db.select().from(surveysTable);
    expect(rows).toHaveLength(1);
    expect(rows[0].patientId).toBe(1);
    expect(rows[0].smsStatus).toBe("pending");
    expect(rows[0].sentAt).toBe(NOW);
    expect(rows[0].uuid).toBeTruthy();
  });

  it("فراخوانی دوم داخل بازه محدودیت null برمی‌گرداند", async () => {
    const first = await reserveSurveySlot(slotArgs());
    expect(first).not.toBeNull();
    const second = await reserveSurveySlot(slotArgs({ now: NOW + 86_400 }));
    expect(second).toBeNull();
    expect(await db.select().from(surveysTable)).toHaveLength(1);
  });

  it("بیمار دیگر مشمول محدودیت این بیمار نمی‌شود", async () => {
    await reserveSurveySlot(slotArgs());
    const other = await reserveSurveySlot(slotArgs({ patientId: 2 }));
    expect(other).not.toBeNull();
    expect(await db.select().from(surveysTable)).toHaveLength(2);
  });

  it("پس از پایان بازه (۳۰ روز) دوباره مجاز است", async () => {
    await reserveSurveySlot(slotArgs());
    const later = await reserveSurveySlot(
      slotArgs({ now: NOW + 31 * 86_400 }),
    );
    expect(later).not.toBeNull();
    expect(await db.select().from(surveysTable)).toHaveLength(2);
  });

  it("با محدودیت ۰ روز هیچ منعی وجود ندارد (درج ساده با uuid پیش‌فرض)", async () => {
    const a = await reserveSurveySlot(slotArgs({ throttleDays: 0 }));
    const b = await reserveSurveySlot(slotArgs({ throttleDays: 0 }));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const rows = await db.select().from(surveysTable);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.uuid)).toBe(true);
  });
});
