import { eq, or, isNull, like, and, gt, lt } from "drizzle-orm";
import {
  db,
  appointmentsTable,
  paymentsTable,
  patientsTable,
  servicesTable,
  remindersTable,
} from "@workspace/db";
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
