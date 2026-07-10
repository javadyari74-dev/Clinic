import { eq, inArray } from "drizzle-orm";
import { db, appSettingsTable, smsLogTable } from "@workspace/db";
import { logger } from "./logger";

// ─────────────────────────────────────────────────────────────────────────────
// سرویس پیامک ملی‌پیامک (Melipayamak)
//
// نکته مهم: برنامه باید کاملاً آفلاین هم کار کند. بنابراین ارسال پیامک همیشه
// «آتش و فراموش» است: اگر اینترنت یا پنل در دسترس نباشد، عملیات اصلی (ثبت نوبت،
// پرداخت، کمیسیون) بدون خطا ادامه می‌یابد و فقط یک ردیف «ناموفق» در تاریخچه
// پیامک ثبت می‌شود. هیچ تابعی در این ماژول نباید به جریان اصلی خطا پرتاب کند.
// ─────────────────────────────────────────────────────────────────────────────

const MELIPAYAMAK_BASE = "https://rest.payamak-panel.com/api/SendSMS";
const REQUEST_TIMEOUT_MS = 15_000;

// ── کلیدهای تنظیمات در جدول app_settings ─────────────────────────────────────
export const SMS_SETTING_KEYS = {
  username: "sms_username",
  password: "sms_password",
  from: "sms_from",
  enabledAppointment: "sms_enabled_appointment",
  enabledPayment: "sms_enabled_payment",
  enabledCommission: "sms_enabled_commission",
} as const;

export const SMS_TEMPLATE_KEYS = {
  appointment: "sms_template_appointment",
  payment: "sms_template_payment",
  commission: "sms_template_commission",
  birthday: "sms_template_birthday",
} as const;

export type SmsTemplateName = keyof typeof SMS_TEMPLATE_KEYS;

// ── قالب‌های پیش‌فرض فارسی ────────────────────────────────────────────────────
export const DEFAULT_TEMPLATES: Record<SmsTemplateName, string> = {
  appointment:
    "{نام} عزیز، نوبت شما در مطب زیبایی دکتر یاری برای {تاریخ} ساعت {ساعت} ثبت شد. منتظر حضور شما هستیم.",
  payment:
    "{نام} عزیز، مبلغ {مبلغ} تومان بابت {خدمت} در مطب زیبایی دکتر یاری پرداخت شد. از اعتماد شما سپاسگزاریم.",
  commission:
    "{نام} عزیز، بابت معرفی، مبلغ {پورسانت} تومان ({درصد}٪ از {مبلغ} تومان) به حساب شما در مطب زیبایی دکتر یاری منظور شد.",
  birthday:
    "{نام} عزیز، تولدتان مبارک! 🎉 به همین مناسبت از طرف مطب زیبایی دکتر یاری تخفیف ویژه‌ای برای شما در نظر گرفته شده است.",
};

// ── ابزارهای قالب و قالب‌بندی ─────────────────────────────────────────────────

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function toPersianDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

// مبلغ به تومان با جداکننده هزارگان و ارقام فارسی
export function formatToman(amount: number): string {
  return toPersianDigits(Math.round(amount).toLocaleString("en-US"));
}

function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const gDaysInMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) +
    gd +
    gDaysInMonth[gm - 1];

  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;

  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }

  let jm: number, jd: number;
  if (days < 186) {
    jm = 1 + Math.floor(days / 31);
    jd = 1 + (days % 31);
  } else {
    jm = 7 + Math.floor((days - 186) / 30);
    jd = 1 + ((days - 186) % 30);
  }
  return [jy, jm, jd];
}

const SHAMSI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

// برخی رکوردها زمان را به میلی‌ثانیه و برخی به ثانیه ذخیره کرده‌اند؛ خودکار تشخیص می‌دهیم.
function toDate(timestamp: number): Date {
  const ms = timestamp > 100_000_000_000 ? timestamp : timestamp * 1000;
  return new Date(ms);
}

export function formatShamsiDateForSms(timestamp: number): string {
  const d = toDate(timestamp);
  const [jy, jm, jd] = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return `${toPersianDigits(jd)} ${SHAMSI_MONTHS[jm - 1]} ${toPersianDigits(jy)}`;
}

export function formatTimeForSms(timestamp: number): string {
  const d = toDate(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return toPersianDigits(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
}

// جایگذاری متغیرها در قالب: {نام}، {تاریخ}، {ساعت}، {مبلغ}، {خدمت}، {درصد}، {پورسانت}
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([^{}]+)\}/g, (whole, key: string) => {
    const k = key.trim();
    return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : whole;
  });
}

// نرمال‌سازی شماره موبایل به شکل 09xxxxxxxxx (ارقام فارسی/عربی هم پذیرفته می‌شوند)
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw)
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[^0-9+]/g, "");
  if (s.startsWith("+98")) s = "0" + s.slice(3);
  else if (s.startsWith("0098")) s = "0" + s.slice(4);
  else if (s.startsWith("98") && s.length === 12) s = "0" + s.slice(2);
  else if (s.startsWith("9") && s.length === 10) s = "0" + s;
  if (/^09\d{9}$/.test(s)) return s;
  return null;
}

// ── خواندن/نوشتن تنظیمات ─────────────────────────────────────────────────────

export interface SmsSettings {
  username: string;
  password: string;
  from: string;
  enabledAppointment: boolean;
  enabledPayment: boolean;
  enabledCommission: boolean;
}

async function readSettingsMap(keys: string[]): Promise<Map<string, string | null>> {
  const rows = await db
    .select()
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, keys));
  const map = new Map<string, string | null>();
  for (const r of rows) map.set(r.key, r.value);
  return map;
}

export async function getSmsSettings(): Promise<SmsSettings> {
  const map = await readSettingsMap(Object.values(SMS_SETTING_KEYS));
  const flag = (key: string) => (map.get(key) ?? "true") !== "false";
  return {
    username: map.get(SMS_SETTING_KEYS.username) ?? "",
    password: map.get(SMS_SETTING_KEYS.password) ?? "",
    from: map.get(SMS_SETTING_KEYS.from) ?? "",
    enabledAppointment: flag(SMS_SETTING_KEYS.enabledAppointment),
    enabledPayment: flag(SMS_SETTING_KEYS.enabledPayment),
    enabledCommission: flag(SMS_SETTING_KEYS.enabledCommission),
  };
}

export async function setAppSetting(key: string, value: string | null): Promise<void> {
  await db
    .insert(appSettingsTable)
    .values({ key, value, updatedAt: Math.floor(Date.now() / 1000) })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value, updatedAt: Math.floor(Date.now() / 1000) },
    });
}

export async function getSmsTemplates(): Promise<Record<SmsTemplateName, string>> {
  const map = await readSettingsMap(Object.values(SMS_TEMPLATE_KEYS));
  const result = {} as Record<SmsTemplateName, string>;
  for (const name of Object.keys(SMS_TEMPLATE_KEYS) as SmsTemplateName[]) {
    const stored = map.get(SMS_TEMPLATE_KEYS[name]);
    result[name] = stored && stored.trim() ? stored : DEFAULT_TEMPLATES[name];
  }
  return result;
}

// ── فراخوانی REST ملی‌پیامک ───────────────────────────────────────────────────

interface MelipayamakResponse {
  Value?: string;
  RetStatus?: number;
  StrRetStatus?: string;
}

async function callMelipayamak(
  endpoint: "SendSMS" | "GetCredit",
  body: Record<string, unknown>,
): Promise<MelipayamakResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${MELIPAYAMAK_BASE}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as MelipayamakResponse;
  } finally {
    clearTimeout(timer);
  }
}

// پیام خطای قابل‌فهم برای کاربر بر اساس پاسخ پنل
function describeSendFailure(resp: MelipayamakResponse): string {
  const code = String(resp.Value ?? "");
  const known: Record<string, string> = {
    "0": "نام کاربری یا رمز عبور پنل اشتباه است",
    "2": "اعتبار پنل پیامکی کافی نیست",
    "6": "سامانه پنل در حال به‌روزرسانی است",
    "7": "متن پیام شامل کلمه فیلترشده است",
    "10": "کاربر پنل فعال نیست",
    "11": "ارسال از پنل مجاز نیست",
    "35": "شماره فرستنده معتبر نیست یا دسترسی ندارد",
  };
  return known[code] ?? `ارسال ناموفق (کد ${code || resp.StrRetStatus || "نامشخص"})`;
}

// ── ارسال پیامک (هرگز خطا پرتاب نمی‌کند) ─────────────────────────────────────

export interface SendSmsInput {
  to: string;
  text: string;
  eventType: "appointment" | "payment" | "commission" | "birthday" | "manual";
  recipientName?: string | null;
  patientId?: number | null;
}

export interface SendSmsResult {
  ok: boolean;
  error?: string;
}

export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const phone = normalizePhone(input.to);
  let status = "failed";
  let error: string | null = null;

  try {
    if (!phone) {
      error = "شماره موبایل معتبر نیست";
    } else {
      const settings = await getSmsSettings();
      if (!settings.username || !settings.password || !settings.from) {
        error = "تنظیمات پنل پیامکی کامل نیست";
      } else {
        const resp = await callMelipayamak("SendSMS", {
          username: settings.username,
          password: settings.password,
          to: phone,
          from: settings.from,
          text: input.text,
          isflash: false,
        });
        // موفقیت: RetStatus=1 و Value یک شناسه بلند (recId) است
        const value = String(resp.Value ?? "");
        if (resp.RetStatus === 1 && value.length > 10) {
          status = "sent";
        } else {
          error = describeSendFailure(resp);
        }
      }
    }
  } catch (err) {
    error =
      err instanceof Error && err.name === "AbortError"
        ? "عدم دسترسی به اینترنت یا پنل پیامکی (مهلت تمام شد)"
        : "عدم دسترسی به اینترنت یا پنل پیامکی";
    logger.warn({ err }, "SMS send failed");
  }

  try {
    await db.insert(smsLogTable).values({
      recipientPhone: phone ?? String(input.to ?? ""),
      recipientName: input.recipientName ?? null,
      patientId: input.patientId ?? null,
      eventType: input.eventType,
      message: input.text,
      status,
      error,
    });
  } catch (err) {
    logger.error({ err }, "Failed to write sms_log");
  }

  return status === "sent" ? { ok: true } : { ok: false, error: error ?? "ارسال ناموفق" };
}

// ── استعلام اعتبار پنل (برای دکمه «تست اتصال») ───────────────────────────────

export async function getPanelCredit(): Promise<{ ok: boolean; credit?: number; error?: string }> {
  try {
    const settings = await getSmsSettings();
    if (!settings.username || !settings.password) {
      return { ok: false, error: "نام کاربری و رمز عبور پنل را وارد کنید" };
    }
    const resp = await callMelipayamak("GetCredit", {
      username: settings.username,
      password: settings.password,
    });
    if (resp.RetStatus === 1) {
      return { ok: true, credit: Number(resp.Value ?? 0) };
    }
    return { ok: false, error: describeSendFailure(resp) };
  } catch {
    return { ok: false, error: "عدم دسترسی به اینترنت یا پنل پیامکی" };
  }
}

// ── رویدادهای خودکار (آتش و فراموش) ──────────────────────────────────────────
// این توابع عمداً async را با void صدا می‌زنیم تا جریان اصلی معطل نماند.

export function fireAppointmentSms(args: {
  patientId: number;
  patientName: string | null;
  phone: string | null;
  scheduledAt: number;
  serviceName?: string | null;
}): void {
  void (async () => {
    try {
      const settings = await getSmsSettings();
      if (!settings.enabledAppointment) return;
      const templates = await getSmsTemplates();
      const text = renderTemplate(templates.appointment, {
        "نام": args.patientName ?? "",
        "تاریخ": formatShamsiDateForSms(args.scheduledAt),
        "ساعت": formatTimeForSms(args.scheduledAt),
        "خدمت": args.serviceName ?? "",
      });
      // شماره خالی/نامعتبر هم به sendSms می‌رود تا در تاریخچه «ناموفق» ثبت شود
      await sendSms({
        to: args.phone ?? "",
        text,
        eventType: "appointment",
        recipientName: args.patientName,
        patientId: args.patientId,
      });
    } catch (err) {
      logger.warn({ err }, "fireAppointmentSms failed");
    }
  })();
}

export function firePaymentSms(args: {
  patientId?: number | null;
  patientName: string | null;
  phone: string | null;
  amount: number;
  serviceName?: string | null;
}): void {
  void (async () => {
    try {
      const settings = await getSmsSettings();
      if (!settings.enabledPayment) return;
      if (args.amount <= 0) return;
      const templates = await getSmsTemplates();
      const text = renderTemplate(templates.payment, {
        "نام": args.patientName ?? "",
        "مبلغ": formatToman(args.amount),
        "خدمت": args.serviceName || "خدمات",
      });
      await sendSms({
        to: args.phone ?? "",
        text,
        eventType: "payment",
        recipientName: args.patientName,
        patientId: args.patientId ?? null,
      });
    } catch (err) {
      logger.warn({ err }, "firePaymentSms failed");
    }
  })();
}

export function fireCommissionSms(args: {
  referrerName: string | null;
  phone: string | null;
  commissionAmount: number;
  baseAmount?: number | null;
  rate?: number | null;
  referrerPatientId?: number | null;
}): void {
  void (async () => {
    try {
      const settings = await getSmsSettings();
      if (!settings.enabledCommission) return;
      if (args.commissionAmount <= 0) return;
      const templates = await getSmsTemplates();
      const text = renderTemplate(templates.commission, {
        "نام": args.referrerName ?? "",
        "پورسانت": formatToman(args.commissionAmount),
        "درصد": args.rate != null && args.rate > 0 ? toPersianDigits(args.rate) : "—",
        "مبلغ": args.baseAmount != null && args.baseAmount > 0 ? formatToman(args.baseAmount) : "—",
      });
      await sendSms({
        to: args.phone ?? "",
        text,
        eventType: "commission",
        recipientName: args.referrerName,
        patientId: args.referrerPatientId ?? null,
      });
    } catch (err) {
      logger.warn({ err }, "fireCommissionSms failed");
    }
  })();
}
