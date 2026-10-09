import { sql, type SQL } from "drizzle-orm";
import { gregorianToJalali } from "./shamsi";

// مرزهای زمانی گزارش‌ها به وقت تهران (UTC+3:30 ثابت، بدون ساعت تابستانی) و تقویم شمسی.
// همهٔ خروجی‌ها ثانیهٔ یونیکس‌اند و end انحصاری است؛ همان قراردادی که صفحهٔ حسابداری
// با presetRange در مرورگر می‌فرستد، تا «این ماه» داشبورد و حسابداری یکی باشد.

export const TEHRAN_OFFSET_SEC = 12_600;
const DAY = 86_400;

export interface PeriodBounds { start: number; end: number }

/** ابتدای روز تهرانِ لحظهٔ داده‌شده (ثانیه) */
export function tehranDayStart(sec: number): number {
  return Math.floor((sec + TEHRAN_OFFSET_SEC) / DAY) * DAY - TEHRAN_OFFSET_SEC;
}

/** شماره روز تهران (برای گروه‌بندی) و تاریخ میلادی آن روز «YYYY-MM-DD» */
export function tehranDayIndex(sec: number): number {
  return Math.floor((sec + TEHRAN_OFFSET_SEC) / DAY);
}

function jalaliOfDay(dayStartSec: number): [number, number, number] {
  const t = new Date((dayStartSec + TEHRAN_OFFSET_SEC) * 1000);
  return gregorianToJalali(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** امروزِ تهران */
export function tehranTodayBounds(nowMs = Date.now()): PeriodBounds {
  const start = tehranDayStart(Math.floor(nowMs / 1000));
  return { start, end: start + DAY };
}

/** ماه شمسیِ جاری به وقت تهران (از ۱ ماه تا ۱ ماه بعد) */
export function shamsiMonthBounds(nowMs = Date.now()): PeriodBounds {
  const today = tehranDayStart(Math.floor(nowMs / 1000));
  let start = today;
  while (jalaliOfDay(start)[2] !== 1) start -= DAY;
  let end = today + DAY;
  while (jalaliOfDay(end)[2] !== 1) end += DAY;
  return { start, end };
}

/** سال شمسیِ جاری به وقت تهران (از ۱ فروردین تا ۱ فروردین سال بعد) */
export function shamsiYearBounds(nowMs = Date.now()): PeriodBounds {
  let start = shamsiMonthBounds(nowMs).start;
  while (jalaliOfDay(start)[1] !== 1) start = shamsiMonthBounds((start - DAY) * 1000).start;
  let end = shamsiMonthBounds(nowMs).end;
  while (jalaliOfDay(end)[1] !== 1) end = shamsiMonthBounds(end * 1000).end;
  return { start, end };
}

/**
 * زمان نوبت به میلی‌ثانیه در SQL. scheduled_at میلی‌ثانیه است ولی چند ردیف قدیمی ثانیه
 * ذخیره شده‌اند؛ تا پایان مهاجرت هر دو را درست مقایسه می‌کنیم.
 */
export function scheduledAtMsSql(col: SQL | string = "scheduled_at"): SQL {
  const c = typeof col === "string" ? sql.raw(col) : col;
  return sql`(CASE WHEN ${c} < 100000000000 THEN ${c} * 1000 ELSE ${c} END)`;
}
