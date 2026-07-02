import { eq, or, isNull, like, sql } from "drizzle-orm";
import {
  db,
  appointmentsTable,
  paymentsTable,
  patientsTable,
  servicesTable,
} from "@workspace/db";
import { generateUniqueAppointmentCode } from "./appointment-code";

export async function backfillAppointmentCodes(): Promise<void> {
  const needsCode = await db
    .select({ id: appointmentsTable.id })
    .from(appointmentsTable)
    .where(or(isNull(appointmentsTable.appointmentCode), like(appointmentsTable.appointmentCode, "APT-%")));

  if (needsCode.length === 0) return;

  for (const appt of needsCode) {
    const appointmentCode = await generateUniqueAppointmentCode();
    await db
      .update(appointmentsTable)
      .set({ appointmentCode })
      .where(eq(appointmentsTable.id, appt.id));
  }
}

// نسخه‌های قدیمی پرداخت‌ها فاقد جزئیات (مراجع/خدمت/شماره جلسه/واحد) بودند.
// این تابع آن‌ها را از روی نوبت مرتبط پر می‌کند تا رسید همه پرداخت‌ها کامل باشد.
export async function backfillPaymentSnapshots(): Promise<void> {
  const needsSnapshot = await db
    .select({
      paymentId: paymentsTable.id,
      patientName: patientsTable.name,
      serviceName: servicesTable.name,
      sessionNumber: appointmentsTable.sessionNumber,
      unitLabel: servicesTable.unitLabel,
    })
    .from(paymentsTable)
    .leftJoin(appointmentsTable, eq(paymentsTable.appointmentId, appointmentsTable.id))
    .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .leftJoin(servicesTable, eq(appointmentsTable.serviceId, servicesTable.id))
    .where(isNull(paymentsTable.patientName));

  if (needsSnapshot.length === 0) return;

  for (const row of needsSnapshot) {
    await db
      .update(paymentsTable)
      .set({
        patientName: row.patientName ?? null,
        serviceName: row.serviceName ?? null,
        sessionNumber: row.sessionNumber ?? null,
        unitLabel: row.unitLabel ?? null,
      })
      .where(eq(paymentsTable.id, row.paymentId));
  }
}

// جداول اصلی که باید شناسه یکتای سراسری (uuid) داشته باشند.
const UUID_TABLES = [
  "patients",
  "appointments",
  "payments",
  "services",
  "staff",
  "discounts",
  "inventory",
  "commissions",
  "commission_recipients",
  "reminders",
  "patient_notes",
  "activity_log",
  "expenses",
  "users",
  "patient_account_transactions",
] as const;

// عبارت تولید UUID نسخه ۴ در سطح SQLite (رقم نسخه = 4، رقم واریانت = 8/9/a/b).
const UUID_V4_SQL =
  "lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))";

// ردیف‌های موجود فاقد uuid را با یک UUID یکتا پر می‌کند و تعداد پرشده هر جدول را برمی‌گرداند.
export async function backfillUuids(): Promise<Record<string, number>> {
  const report: Record<string, number> = {};
  for (const table of UUID_TABLES) {
    const rows = (await db.all(
      sql.raw(`SELECT count(*) AS c FROM "${table}" WHERE uuid IS NULL`),
    )) as { c: number }[];
    const missing = Number(rows?.[0]?.c ?? 0);
    if (missing > 0) {
      await db.run(
        sql.raw(`UPDATE "${table}" SET uuid = (${UUID_V4_SQL}) WHERE uuid IS NULL`),
      );
    }
    report[table] = missing;
  }

  // پس از پرکردن، مطمئن می‌شویم هیچ ردیفی بدون uuid باقی نمانده؛ در غیر این صورت
  // مانند سایر بخش‌های راه‌اندازی، با خطای صریح متوقف می‌شویم تا مشکل پنهان نماند.
  const leftover: string[] = [];
  for (const table of UUID_TABLES) {
    const rows = (await db.all(
      sql.raw(`SELECT count(*) AS c FROM "${table}" WHERE uuid IS NULL`),
    )) as { c: number }[];
    if (Number(rows?.[0]?.c ?? 0) > 0) leftover.push(table);
  }
  if (leftover.length > 0) {
    throw new Error(
      `UUID backfill incomplete: tables still have NULL uuid: ${leftover.join(", ")}`,
    );
  }

  return report;
}
