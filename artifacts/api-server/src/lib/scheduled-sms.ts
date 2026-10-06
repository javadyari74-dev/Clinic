import { and, eq, gte, inArray, isNotNull, lte, or } from "drizzle-orm";
import {
  db,
  appointmentsTable,
  patientsTable,
  remindersTable,
  servicesTable,
  scheduledSmsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { gregorianToJalali } from "./shamsi";
import { getTodaysBirthdayBonus } from "./loyalty";
import {
  getSmsSettings,
  getSmsTemplates,
  normalizePhone,
  renderTemplate,
  sendSms,
  toPersianDigits,
  formatToman,
  type SmsSettings,
} from "./sms";

// ─────────────────────────────────────────────────────────────────────────────
// پیامک‌های زمان‌بندی‌شده: یادآوری نوبت (روز قبل)، یادآوری برگشت (روز سررسید)
// و تبریک تولد (روز تولد). هر چند دقیقه یک‌بار runScheduledSms صدا زده می‌شود.
//
// - همهٔ زمان‌ها به وقت تهران حساب می‌شوند (ایران از ۱۴۰۱ ساعت تابستانی ندارد)،
//   پس روی سروری با منطقهٔ زمانی دیگر هم درست کار می‌کند.
// - هر پیامک یک کلید یکتا در جدول scheduled_sms دارد؛ پیامکِ ارسال‌شده دوباره
//   فرستاده نمی‌شود. ارسال ناموفق (مثلاً قطع اینترنت) حداکثر ۳ بار و با فاصلهٔ
//   دست‌کم ۳۰ دقیقه دوباره تلاش می‌شود.
// - اگر برنامه سر ساعت باز نباشد، با باز شدن برنامه (تا وقتی هنوز معنی دارد)
//   ارسال می‌شود: یادآوری نوبت تا یک ساعت قبل از نوبت، یادآوری برگشت تا ۳ روز
//   بعد از سررسید، تبریک تولد فقط در خود روز تولد.
// ─────────────────────────────────────────────────────────────────────────────

const TEHRAN_OFFSET_MS = 210 * 60 * 1000;
const HOUR_MS = 3600_000;
const DAY_MS = 86_400_000;
export const MAX_ATTEMPTS = 3;
const RETRY_AFTER_SEC = 30 * 60;
const FOLLOWUP_GRACE_DAYS = 3;
const ACTIVE_APPOINTMENT_STATUSES = ["scheduled", "confirmed"];

const SHAMSI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

/** تاریخ و ساعت تهران برای یک لحظه (میلی‌ثانیه) */
export function tehranParts(ms: number): { y: number; m: number; d: number; hour: number; minute: number } {
  const t = new Date(ms + TEHRAN_OFFSET_MS);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
  };
}

/** لحظهٔ (میلی‌ثانیه) مربوط به تاریخ میلادی و ساعت داده‌شده به وقت تهران */
export function tehranInstant(y: number, m: number, d: number, hour = 0): number {
  return Date.UTC(y, m - 1, d, hour) - TEHRAN_OFFSET_MS;
}

/** ابتدای روز تهرانِ لحظهٔ داده‌شده (میلی‌ثانیه) */
function tehranDayStart(ms: number): number {
  const p = tehranParts(ms);
  return tehranInstant(p.y, p.m, p.d);
}

// زمان نوبت‌ها گاهی میلی‌ثانیه و گاهی ثانیه ذخیره شده است
const toMs = (ts: number) => (ts > 100_000_000_000 ? ts : ts * 1000);

export function shamsiDateText(ms: number): string {
  const p = tehranParts(ms);
  const [jy, jm, jd] = gregorianToJalali(p.y, p.m, p.d);
  return `${toPersianDigits(jd)} ${SHAMSI_MONTHS[jm - 1]} ${toPersianDigits(jy)}`;
}

function timeText(ms: number): string {
  const p = tehranParts(ms);
  return toPersianDigits(`${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`);
}

/**
 * از چه لحظه‌ای یادآوری یک نوبت باید ارسال شود: روز قبل از نوبت، ساعت reminderHour به وقت تهران.
 * پس از «یک ساعت مانده به نوبت» دیگر ارسال نمی‌شود.
 */
export function appointmentReminderWindow(scheduledAtMs: number, reminderHour: number): { from: number; until: number } {
  const p = tehranParts(scheduledAtMs - DAY_MS);
  return { from: tehranInstant(p.y, p.m, p.d, reminderHour), until: scheduledAtMs - HOUR_MS };
}

/** ماه و روز شمسی تولد از رشتهٔ تاریخ تولد (میلادی YYYY-MM-DD، یا قدیمی‌ها شمسی) */
export function birthShamsiMonthDay(birthdate: string | null | undefined): { m: number; d: number } | null {
  if (!birthdate) return null;
  const parts = birthdate.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [y, m, d] = parts;
  if (y > 1700) {
    const [, jm, jd] = gregorianToJalali(y, m, d);
    return { m: jm, d: jd };
  }
  return { m, d };
}

// ── رزرو و ثبت نتیجه برای جلوگیری از ارسال تکراری ─────────────────────────────

export async function claimScheduledSms(key: string, kind: string, nowSec: number): Promise<boolean> {
  const existing = await db.select().from(scheduledSmsTable).where(eq(scheduledSmsTable.key, key)).get();
  if (!existing) {
    await db
      .insert(scheduledSmsTable)
      .values({ key, kind, status: "pending", attempts: 1, lastAttemptAt: nowSec, createdAt: nowSec })
      .onConflictDoNothing();
    return true;
  }
  if (existing.status === "sent") return false;
  // ناموفق (یا «در حال ارسال» که برنامه وسطش بسته شده) → تلاش دوباره با محدودیت
  if (existing.attempts >= MAX_ATTEMPTS) return false;
  if (nowSec - existing.lastAttemptAt < RETRY_AFTER_SEC) return false;
  await db
    .update(scheduledSmsTable)
    .set({ status: "pending", attempts: existing.attempts + 1, lastAttemptAt: nowSec })
    .where(eq(scheduledSmsTable.key, key));
  return true;
}

export async function finishScheduledSms(key: string, ok: boolean): Promise<void> {
  await db.update(scheduledSmsTable).set({ status: ok ? "sent" : "failed" }).where(eq(scheduledSmsTable.key, key));
}

// ── سه نوع پیامک ─────────────────────────────────────────────────────────────

async function sendAppointmentReminders(settings: SmsSettings, nowMs: number): Promise<number> {
  const nowSec = Math.floor(nowMs / 1000);
  // نوبت‌های فعالِ ۱ تا ۴۸ ساعت آینده (هر دو واحد ذخیره‌سازی)
  const lo = nowMs + HOUR_MS;
  const hi = nowMs + 2 * DAY_MS;
  const rows = await db
    .select({
      id: appointmentsTable.id,
      scheduledAt: appointmentsTable.scheduledAt,
      patientId: patientsTable.id,
      name: patientsTable.name,
      phone: patientsTable.phone,
      serviceName: servicesTable.name,
    })
    .from(appointmentsTable)
    .innerJoin(patientsTable, eq(patientsTable.id, appointmentsTable.patientId))
    .leftJoin(servicesTable, eq(servicesTable.id, appointmentsTable.serviceId))
    .where(
      and(
        inArray(appointmentsTable.status, ACTIVE_APPOINTMENT_STATUSES),
        or(
          and(gte(appointmentsTable.scheduledAt, lo), lte(appointmentsTable.scheduledAt, hi)),
          and(gte(appointmentsTable.scheduledAt, Math.floor(lo / 1000)), lte(appointmentsTable.scheduledAt, Math.floor(hi / 1000))),
        ),
      ),
    );

  const templates = await getSmsTemplates();
  let sent = 0;
  for (const r of rows) {
    const at = toMs(r.scheduledAt);
    const win = appointmentReminderWindow(at, settings.appointmentReminderHour);
    if (nowMs < win.from || nowMs > win.until) continue;
    if (!normalizePhone(r.phone)) continue;
    // نوبتِ جابه‌جاشده کلید تازه می‌گیرد و دوباره یادآوری می‌شود
    const key = `appointment:${r.id}:${r.scheduledAt}`;
    if (!(await claimScheduledSms(key, "appointment_reminder", nowSec))) continue;
    const name = r.name ?? "";
    const date = shamsiDateText(at);
    const time = timeText(at);
    const result = await sendSms({
      to: r.phone,
      text: renderTemplate(templates.appointmentReminder, { "نام": name, "تاریخ": date, "ساعت": time, "خدمت": r.serviceName ?? "" }),
      eventType: "appointment_reminder",
      recipientName: r.name,
      patientId: r.patientId,
      pattern: settings.sendMode === "pattern"
        ? { bodyId: settings.bodyIdAppointmentReminder, args: [name, date, time] }
        : undefined,
    });
    await finishScheduledSms(key, result.ok);
    if (result.ok) sent++;
  }
  return sent;
}

async function sendFollowupReminders(settings: SmsSettings, nowMs: number): Promise<number> {
  const nowSec = Math.floor(nowMs / 1000);
  if (tehranParts(nowMs).hour < settings.dailyAutoHour) return 0;
  const todayStart = tehranDayStart(nowMs);
  const fromSec = Math.floor((todayStart - FOLLOWUP_GRACE_DAYS * DAY_MS) / 1000);
  const toSec = Math.floor((todayStart + DAY_MS) / 1000) - 1;
  const rows = await db
    .select({
      id: remindersTable.id,
      dueAt: remindersTable.dueAt,
      patientId: patientsTable.id,
      name: patientsTable.name,
      phone: patientsTable.phone,
    })
    .from(remindersTable)
    .innerJoin(patientsTable, eq(patientsTable.id, remindersTable.patientId))
    .where(
      and(
        eq(remindersTable.type, "followup"),
        eq(remindersTable.status, "pending"),
        gte(remindersTable.dueAt, fromSec),
        lte(remindersTable.dueAt, toSec),
      ),
    );

  const templates = await getSmsTemplates();
  let sent = 0;
  for (const r of rows) {
    if (!normalizePhone(r.phone)) continue;
    const key = `followup:${r.id}:${r.dueAt}`;
    if (!(await claimScheduledSms(key, "followup_reminder", nowSec))) continue;
    const name = r.name ?? "";
    const result = await sendSms({
      to: r.phone,
      text: renderTemplate(templates.followupReminder, { "نام": name, "تاریخ": shamsiDateText(r.dueAt * 1000) }),
      eventType: "followup_reminder",
      recipientName: r.name,
      patientId: r.patientId,
      pattern: settings.sendMode === "pattern"
        ? { bodyId: settings.bodyIdFollowupReminder, args: [name] }
        : undefined,
    });
    await finishScheduledSms(key, result.ok);
    if (result.ok) sent++;
  }
  return sent;
}

async function sendBirthdayGreetings(settings: SmsSettings, nowMs: number): Promise<number> {
  const nowSec = Math.floor(nowMs / 1000);
  if (tehranParts(nowMs).hour < settings.dailyAutoHour) return 0;
  const p = tehranParts(nowMs);
  const [jy, jm, jd] = gregorianToJalali(p.y, p.m, p.d);
  const patients = await db
    .select({ id: patientsTable.id, name: patientsTable.name, phone: patientsTable.phone, birthdate: patientsTable.birthdate })
    .from(patientsTable)
    .where(isNotNull(patientsTable.birthdate));

  const templates = await getSmsTemplates();
  let sent = 0;
  for (const r of patients) {
    const b = birthShamsiMonthDay(r.birthdate);
    if (!b || b.m !== jm || b.d !== jd) continue;
    if (!normalizePhone(r.phone)) continue;
    const key = `birthday:${r.id}:${jy}`;
    if (!(await claimScheduledSms(key, "birthday", nowSec))) continue;
    const name = r.name ?? "";
    // اگر امروز امتیاز هدیهٔ تولد باشگاه داده شده، در همین پیامک گفته می‌شود
    const bonus = await getTodaysBirthdayBonus(r.id, nowSec);
    const result = await sendSms({
      to: r.phone,
      text: renderTemplate(templates.birthday, {
        "نام": name,
        "هدیه_باشگاه": bonus > 0 ? ` ${formatToman(bonus)} تومان اعتبار هدیه هم به کیف پول شما اضافه شد.` : "",
      }),
      eventType: "birthday",
      recipientName: r.name,
      patientId: r.id,
      pattern: settings.sendMode === "pattern" ? { bodyId: settings.bodyIdBirthday, args: [name] } : undefined,
    });
    await finishScheduledSms(key, result.ok);
    if (result.ok) sent++;
  }
  return sent;
}

export interface ScheduledSmsResult {
  appointmentReminders: number;
  followupReminders: number;
  birthdays: number;
}

/** یک دور بررسی و ارسال. هرگز خطا پرتاب نمی‌کند. */
export async function runScheduledSms(nowMs = Date.now()): Promise<ScheduledSmsResult> {
  const result: ScheduledSmsResult = { appointmentReminders: 0, followupReminders: 0, birthdays: 0 };
  try {
    const settings = await getSmsSettings();
    // بدون تنظیمات پنل، هر دور فقط ردیف «ناموفق» می‌ساخت؛ کاری نمی‌کنیم
    if (!settings.username || !settings.password) return result;
    if (settings.enabledAppointmentReminder) result.appointmentReminders = await sendAppointmentReminders(settings, nowMs);
    if (settings.enabledFollowupReminder) result.followupReminders = await sendFollowupReminders(settings, nowMs);
    if (settings.enabledBirthdayAuto) result.birthdays = await sendBirthdayGreetings(settings, nowMs);
  } catch (err) {
    logger.warn({ err }, "scheduled SMS run failed");
  }
  return result;
}
