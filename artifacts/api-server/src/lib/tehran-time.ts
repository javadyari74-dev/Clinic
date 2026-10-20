import { gregorianToJalali } from "./shamsi";

// ─────────────────────────────────────────────────────────────────────────────
// ابزارهای مشترک «وقت تهران» برای پیامک‌ها. ایران از ۱۴۰۱ ساعت تابستانی ندارد،
// پس اختلاف ثابت UTC+3:30 است و نتیجه به منطقهٔ زمانی سرور بستگی ندارد.
// این فایل عمداً به sms.ts وابسته نیست تا هم sms.ts و هم scheduled-sms.ts
// بتوانند بدون واردسازی چرخه‌ای از آن استفاده کنند.
// ─────────────────────────────────────────────────────────────────────────────

export const TEHRAN_OFFSET_MS = 210 * 60 * 1000;

const SHAMSI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const faDigits = (value: string | number) => String(value).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);

/** برخی رکوردها زمان را به میلی‌ثانیه و برخی به ثانیه ذخیره کرده‌اند؛ خودکار تشخیص می‌دهیم */
export const toMs = (ts: number) => (ts > 100_000_000_000 ? ts : ts * 1000);

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
export function tehranDayStart(ms: number): number {
  const p = tehranParts(ms);
  return tehranInstant(p.y, p.m, p.d);
}

/** تاریخ شمسی تهران یک لحظه (میلی‌ثانیه) */
export function tehranShamsi(ms: number): [number, number, number] {
  const p = tehranParts(ms);
  return gregorianToJalali(p.y, p.m, p.d);
}

/** «۱۴ آبان ۱۴۰۵» به وقت تهران (ورودی میلی‌ثانیه) */
export function shamsiDateText(ms: number): string {
  const [jy, jm, jd] = tehranShamsi(ms);
  return `${faDigits(jd)} ${SHAMSI_MONTHS[jm - 1]} ${faDigits(jy)}`;
}

/** «۱۱:۳۰» به وقت تهران (ورودی میلی‌ثانیه) */
export function timeText(ms: number): string {
  const p = tehranParts(ms);
  return faDigits(`${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`);
}
