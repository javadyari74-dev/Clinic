import { and, eq, gte, inArray, isNotNull, lt, lte, ne, notInArray, or } from "drizzle-orm";
import {
  db,
  appointmentsTable,
  patientsTable,
  remindersTable,
  servicesTable,
  scheduledSmsTable,
  smsLogTable,
} from "@workspace/db";
import { logger } from "./logger";
import { gregorianToJalali } from "./shamsi";
import { shamsiDateText, tehranDayStart, tehranInstant, tehranParts, tehranShamsi, timeText, toMs } from "./tehran-time";
import { getTodaysBirthdayBonus } from "./loyalty";
import {
  getSmsSettings,
  getSmsTemplates,
  normalizePhone,
  renderTemplate,
  sendSms,
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

const HOUR_MS = 3600_000;
const DAY_MS = 86_400_000;
export const MAX_ATTEMPTS = 3;
const RETRY_AFTER_SEC = 30 * 60;
const FOLLOWUP_GRACE_DAYS = 3;
const ACTIVE_APPOINTMENT_STATUSES = ["scheduled", "confirmed"];
// نوبتی که کمتر از این مدت پیش از زمانش ثبت شده، یادآوری جدا نمی‌گیرد
// (همان پیامک تأیید ثبت نوبت کافی است)
const MIN_REMINDER_LEAD_MS = 3 * HOUR_MS;

// ابزارهای وقت تهران در tehran-time.ts هستند (مشترک با sms.ts)؛ برای سازگاری
// با واردکننده‌های قبلی از اینجا هم صادر می‌شوند.
export { tehranParts, tehranInstant, shamsiDateText };

/**
 * از چه لحظه‌ای یادآوری یک نوبت باید ارسال شود: روز قبل از نوبت، ساعت reminderHour به وقت تهران.
 * پس از «یک ساعت مانده به نوبت» دیگر ارسال نمی‌شود.
 */
export function appointmentReminderWindow(scheduledAtMs: number, reminderHour: number): { from: number; until: number } {
  const p = tehranParts(scheduledAtMs - DAY_MS);
  return { from: tehranInstant(p.y, p.m, p.d, reminderHour), until: scheduledAtMs - HOUR_MS };
}

/**
 * یادآوری نوبتی که دیر ثبت شده لازم نیست: اگر نوبت بعد از باز شدن پنجرهٔ یادآوری
 * ثبت شده باشد، یا کمتر از MIN_REMINDER_LEAD_MS پیش از زمان نوبت (همه میلی‌ثانیه).
 */
export function skipReminderForLateBooking(createdAtMs: number, scheduledAtMs: number, windowFromMs: number): boolean {
  return createdAtMs >= windowFromMs || scheduledAtMs - createdAtMs < MIN_REMINDER_LEAD_MS;
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

/**
 * سال شمسیِ «تولد پیشِ رو» (امروز یا بعد از امروز، به وقت تهران) — همان سالی که
 * کلید پیامک خودکار تولد (birthday:{شناسه}:{سال}) با آن ساخته می‌شود.
 */
export function upcomingBirthdayShamsiYear(birthdate: string | null | undefined, nowMs: number): number | null {
  const b = birthShamsiMonthDay(birthdate);
  if (!b) return null;
  const [jy, jm, jd] = tehranShamsi(nowMs);
  return b.m > jm || (b.m === jm && b.d >= jd) ? jy : jy + 1;
}

export const birthdaySmsKey = (patientId: number, shamsiYear: number) => `birthday:${patientId}:${shamsiYear}`;

// ── رزرو و ثبت نتیجه برای جلوگیری از ارسال تکراری ─────────────────────────────

// وضعیت‌های نهایی: دیگر هرگز ارسال نمی‌شوند («skipped» = لازم نبود، مثلاً مراجع نوبت آینده دارد)
const FINAL_STATUSES = ["sent", "skipped"];

/**
 * رزرو اتمی ارسال یک پیامک زمان‌بندی‌شده؛ true یعنی همین فراخوان باید بفرستد.
 * - ردیف تازه با INSERT ... ON CONFLICT DO NOTHING RETURNING درج می‌شود؛ اگر دو دور
 *   هم‌زمان باشند فقط یکی ردیف را پس می‌گیرد.
 * - ردیف ناموفق (یا «در حال ارسال» که برنامه وسطش بسته شده) حداکثر MAX_ATTEMPTS بار
 *   و با فاصلهٔ دست‌کم ۳۰ دقیقه دوباره رزرو می‌شود؛ به‌روزرسانی شرطی است (همان
 *   attempts و lastAttemptAt خوانده‌شده) تا دو رزرو هم‌زمان هر دو موفق نشوند.
 * - ردیف «pending» کهنه: اگر پنل پیامک را پذیرفته بوده ولی ثبت نتیجه قطع شده،
 *   ردیف «ارسال‌شده» در sms_log هست؛ در این صورت ردیف «sent» می‌شود و دوباره نمی‌فرستیم.
 *   (kind همان eventType پیامک در sms_log است.)
 */
export async function claimScheduledSms(
  key: string,
  kind: string,
  nowSec: number,
  opts: { patientId?: number | null } = {},
): Promise<boolean> {
  const inserted = await db
    .insert(scheduledSmsTable)
    .values({ key, kind, status: "pending", attempts: 1, lastAttemptAt: nowSec, createdAt: nowSec })
    .onConflictDoNothing()
    .returning({ key: scheduledSmsTable.key });
  if (inserted.length > 0) return true;

  const existing = await db.select().from(scheduledSmsTable).where(eq(scheduledSmsTable.key, key)).get();
  if (!existing) return false;
  if (FINAL_STATUSES.includes(existing.status)) return false;
  if (existing.attempts >= MAX_ATTEMPTS) return false;
  if (nowSec - existing.lastAttemptAt < RETRY_AFTER_SEC) return false;

  if (existing.status === "pending" && opts.patientId != null) {
    const delivered = await db
      .select({ id: smsLogTable.id })
      .from(smsLogTable)
      .where(
        and(
          eq(smsLogTable.patientId, opts.patientId),
          eq(smsLogTable.eventType, kind),
          eq(smsLogTable.status, "sent"),
          gte(smsLogTable.createdAt, existing.lastAttemptAt),
          lt(smsLogTable.createdAt, existing.lastAttemptAt + RETRY_AFTER_SEC),
        ),
      )
      .limit(1);
    if (delivered.length > 0) {
      await db
        .update(scheduledSmsTable)
        .set({ status: "sent" })
        .where(and(eq(scheduledSmsTable.key, key), eq(scheduledSmsTable.status, "pending")));
      return false;
    }
  }

  const updated = await db
    .update(scheduledSmsTable)
    .set({ status: "pending", attempts: existing.attempts + 1, lastAttemptAt: nowSec })
    .where(
      and(
        eq(scheduledSmsTable.key, key),
        notInArray(scheduledSmsTable.status, FINAL_STATUSES),
        eq(scheduledSmsTable.attempts, existing.attempts),
        eq(scheduledSmsTable.lastAttemptAt, existing.lastAttemptAt),
      ),
    )
    .returning({ key: scheduledSmsTable.key });
  return updated.length > 0;
}

export async function finishScheduledSms(key: string, ok: boolean): Promise<void> {
  await db.update(scheduledSmsTable).set({ status: ok ? "sent" : "failed" }).where(eq(scheduledSmsTable.key, key));
}

/**
 * ثبت نهایی یک کلید بدون ارسال از این مسیر: «sent» (مثلاً تبریک تولد دستی همان
 * پیامک را فرستاده) یا «skipped» (لازم نیست). ردیفِ «sent» هرگز بازنویسی نمی‌شود.
 */
export async function markScheduledSms(key: string, kind: string, status: "sent" | "skipped", nowSec: number): Promise<void> {
  await db
    .insert(scheduledSmsTable)
    .values({ key, kind, status, attempts: 0, lastAttemptAt: nowSec, createdAt: nowSec })
    .onConflictDoUpdate({
      target: scheduledSmsTable.key,
      set: { status, lastAttemptAt: nowSec },
      setWhere: ne(scheduledSmsTable.status, "sent"),
    });
}

/** آیا مراجع نوبت فعالِ آینده (از این لحظه به بعد) دارد؟ (هر دو واحد ذخیره‌سازی) */
async function hasUpcomingAppointment(patientId: number, nowMs: number): Promise<boolean> {
  const nowSec = Math.floor(nowMs / 1000);
  const rows = await db
    .select({ id: appointmentsTable.id })
    .from(appointmentsTable)
    .where(
      and(
        eq(appointmentsTable.patientId, patientId),
        inArray(appointmentsTable.status, ACTIVE_APPOINTMENT_STATUSES),
        or(
          gte(appointmentsTable.scheduledAt, nowMs),
          and(lt(appointmentsTable.scheduledAt, 100_000_000_000), gte(appointmentsTable.scheduledAt, nowSec)),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
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
      createdAt: appointmentsTable.createdAt,
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
    // نوبتی که پس از باز شدن پنجرهٔ یادآوری (یا کمتر از ۳ ساعت پیش از زمانش) ثبت
    // شده، همین تازگی پیامک تأیید ثبت گرفته؛ یادآوری دوم چند دقیقه بعد آزاردهنده است.
    // (created_at به ثانیه است؛ نوبتِ جابه‌جاشده با created_at قدیمی یادآوری می‌گیرد.)
    if (skipReminderForLateBooking(toMs(r.createdAt), at, win.from)) continue;
    if (!normalizePhone(r.phone)) continue;
    // نوبتِ جابه‌جاشده کلید تازه می‌گیرد و دوباره یادآوری می‌شود
    const key = `appointment:${r.id}:${r.scheduledAt}`;
    if (!(await claimScheduledSms(key, "appointment_reminder", nowSec, { patientId: r.patientId }))) continue;
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
    // مراجعی که خودش نوبت آینده گرفته، پیامک «برای رزرو نوبت تماس بگیرید» نمی‌گیرد؛
    // کلید «skipped» ثبت می‌شود تا در دورهای بعد دوباره بررسی/ارسال نشود.
    if (await hasUpcomingAppointment(r.patientId, nowMs)) {
      const done = await db.select({ status: scheduledSmsTable.status }).from(scheduledSmsTable)
        .where(eq(scheduledSmsTable.key, key)).get();
      if (!done || !FINAL_STATUSES.includes(done.status)) await markScheduledSms(key, "followup_reminder", "skipped", nowSec);
      continue;
    }
    if (!(await claimScheduledSms(key, "followup_reminder", nowSec, { patientId: r.patientId }))) continue;
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
    const key = birthdaySmsKey(r.id, jy);
    if (!(await claimScheduledSms(key, "birthday", nowSec, { patientId: r.id }))) continue;
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
