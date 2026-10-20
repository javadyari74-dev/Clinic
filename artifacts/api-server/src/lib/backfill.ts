import { eq, or, isNull, like, and, gt, lt } from "drizzle-orm";
import {
  db,
  appointmentsTable,
  paymentsTable,
  patientsTable,
  servicesTable,
  remindersTable,
  appSettingsTable,
} from "@workspace/db";
import { fixOverstatedCashback } from "./loyalty";
import { sql } from "drizzle-orm";
import { generateUniqueAppointmentCode } from "./appointment-code";
import { gregorianToJalali } from "./shamsi";

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

// باگ قدیمی: تاریخ میلادیِ انتخاب‌شده در تقویم (مثلاً 2026-11-05 برای ۱۴ آبان ۱۴۰۵) در صفحهٔ
// صندوق و یادآوری‌ها «شمسی» فرض و تبدیل می‌شد، پس سررسید در حدود سال ۲۶۴۸ میلادی ذخیره می‌شد
// (در برنامه به‌صورت «۵ بهمن ۲۰۲۶» دیده می‌شد). در آن مقدار، اجزای تاریخ شمسی همان تاریخ
// میلادیِ مورد نظر کاربر است؛ همان را برمی‌گردانیم (ظهر به وقت محلی).
// فقط سررسیدهای بعد از سال ۲۲۰۰ و به ثانیه (نه میلی‌ثانیه) لمس می‌شوند، پس اجرای دوباره بی‌اثر است.
const YEAR_2200 = Date.UTC(2200, 0, 1) / 1000;
const MS_THRESHOLD = 1e11;

export function repairedReminderDueAt(dueAt: number): number | null {
  if (!(dueAt > YEAR_2200 && dueAt < MS_THRESHOLD)) return null;
  const d = new Date(dueAt * 1000);
  const [y, m, day] = gregorianToJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  const fixed = new Date(y, m - 1, day, 12, 0, 0);
  if (isNaN(fixed.getTime()) || fixed.getFullYear() !== y) return null;
  return Math.floor(fixed.getTime() / 1000);
}

export async function repairShamsiReminderDates(): Promise<number> {
  const broken = await db
    .select({ id: remindersTable.id, dueAt: remindersTable.dueAt })
    .from(remindersTable)
    .where(and(gt(remindersTable.dueAt, YEAR_2200), lt(remindersTable.dueAt, MS_THRESHOLD)));

  let repaired = 0;
  for (const r of broken) {
    const dueAt = repairedReminderDueAt(r.dueAt);
    if (dueAt === null) continue;
    await db.update(remindersTable).set({ dueAt }).where(eq(remindersTable.id, r.id));
    repaired++;
  }
  return repaired;
}

// یک‌بار پس از ارتقا: اعتبار سودهایی که با هزینهٔ «یک جلسه» برای صورت‌حساب‌های چند برابری
// حساب شده بودند اصلاح می‌شوند (lib/loyalty.ts → fixOverstatedCashback). جمع مبلغ کسرشده را برمی‌گرداند.
// v2: هزینهٔ «کل» در خدمات «هر واحد» هم به نسبت واحدهای فروخته‌شده (اجرای دوباره روی داده‌های قبلی بی‌خطر است)
export const BILLED_CASHBACK_FIX_KEY = "data_fix_billed_cost_cashback_v2";
export async function fixOverstatedCashbackOnce(): Promise<number> {
  return db.transaction(async (tx) => {
    const done = await tx.select().from(appSettingsTable).where(eq(appSettingsTable.key, BILLED_CASHBACK_FIX_KEY)).get();
    if (done) return 0;
    const fixed = await fixOverstatedCashback(tx);
    await tx.insert(appSettingsTable).values({ key: BILLED_CASHBACK_FIX_KEY, value: String(Date.now()) });
    return fixed.reduce((t, f) => t + f.removed, 0);
  });
}

// یک‌بار پس از ارتقا: پرداخت‌هایی که بعد از ماهِ خدمت در صندوق ثبت شده‌اند (مثلاً خدمت مرداد که مهر
// ثبت شده) به روز خدمت منتقل می‌شوند تا درآمد، هزینه و سودشان در ماه خودش حساب شود.
// فقط پرداخت‌هایی که دست‌کم یک روز بعد از خدمت و در ماه شمسیِ دیگری ثبت شده‌اند؛ بیعانهٔ پیش از
// خدمت و پرداختِ همان ماه دست نمی‌خورند. کمیسیون‌های همان پرداخت هم با آن جابه‌جا می‌شوند.
export const MOVE_TO_SERVICE_MONTH_KEY = "data_fix_payments_to_service_month";
const TEHRAN_OFFSET_SEC = 12_600;
function shamsiMonthKey(sec: number): string {
  const d = new Date((sec + TEHRAN_OFFSET_SEC) * 1000);
  const [jy, jm] = gregorianToJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  return `${jy}-${jm}`;
}
// paymentIds: فقط همین پرداخت‌ها (مثلاً پرداخت‌های تازه‌ادغام‌شده از یک پشتیبان قدیمی)؛
// بدون آن همهٔ پرداخت‌ها. اجرای دوباره روی پرداختی که منتقل شده بی‌اثر است (فاصله‌اش صفر می‌شود)،
// اما پرداخت‌های تازهٔ ماهِ بعد (مثلاً تسویهٔ بدهی) را هم جابه‌جا می‌کند — پس فقط یک‌بار به ازای داده.
export async function movePaymentsToServiceMonth(
  executor: Pick<typeof db, "all" | "run"> = db,
  paymentIds?: number[],
): Promise<number> {
  if (paymentIds && paymentIds.length === 0) return 0;
  const only = new Set(paymentIds ?? []);
  const rows = await executor.all<{ id: number; paid_at: number; svc: number }>(sql`
    SELECT p.id AS id, p.paid_at AS paid_at,
      (CASE WHEN a.scheduled_at < 100000000000 THEN a.scheduled_at ELSE a.scheduled_at / 1000 END) AS svc
    FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id
    WHERE p.paid_at - (CASE WHEN a.scheduled_at < 100000000000 THEN a.scheduled_at ELSE a.scheduled_at / 1000 END) >= 86400
  `);
  let moved = 0;
  for (const r of rows) {
    if (paymentIds && !only.has(Number(r.id))) continue;
    const svc = Math.floor(Number(r.svc));
    if (shamsiMonthKey(Number(r.paid_at)) === shamsiMonthKey(svc)) continue;
    await executor.run(sql`UPDATE payments SET paid_at = ${svc} WHERE id = ${r.id}`);
    await executor.run(sql`UPDATE commissions SET created_at = ${svc} WHERE payment_id = ${r.id}`);
    moved++;
  }
  return moved;
}
export async function movePaymentsToServiceMonthOnce(): Promise<number> {
  return db.transaction(async (tx) => {
    const done = await tx.select().from(appSettingsTable).where(eq(appSettingsTable.key, MOVE_TO_SERVICE_MONTH_KEY)).get();
    if (done) return 0;
    const moved = await movePaymentsToServiceMonth(tx as unknown as Pick<typeof db, "all" | "run">);
    await tx.insert(appSettingsTable).values({ key: MOVE_TO_SERVICE_MONTH_KEY, value: String(Date.now()) });
    return moved;
  });
}
