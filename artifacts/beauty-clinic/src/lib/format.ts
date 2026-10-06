export function toPersianDigits(num: number | string | null | undefined): string {
  if (num == null) return "";
  const farsiDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return num.toString().replace(/\d/g, x => farsiDigits[parseInt(x)]);
}

export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return "۰ تومان";
  return toPersianDigits(amount.toLocaleString()) + " تومان";
}

// Simple approximation for UI purposes if full jalali library is missing
export function formatShamsiDate(unixTime: number | string | null | undefined, includeTime = false): string {
  if (!unixTime) return "";
  const ts = Number(unixTime);
  // Auto-detect: if ts > 1e11 it's already milliseconds, otherwise it's seconds
  const date = new Date(ts > 1e11 ? ts : ts * 1000);
  if (isNaN(date.getTime())) return "";
  
  // Intl.DateTimeFormat supports Persian calendar!
  const options: Intl.DateTimeFormatOptions = { 
    calendar: 'persian', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  };
  
  if (includeTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }
  
  return new Intl.DateTimeFormat('fa-IR', options).format(date);
}

// Format Date object to YYYY-MM-DD string for input values
export function toISODateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

// PersianDatePicker تاریخ را به‌صورت رشتهٔ «میلادی» YYYY-MM-DD می‌گیرد و برمی‌گرداند
// (فقط نمایشش شمسی است). این دو تابع آن رشته را به/از ثانیهٔ یونیکس تبدیل می‌کنند.
// ساعت ۱۲ ظهر به وقت محلی انتخاب می‌شود تا اختلاف منطقهٔ زمانی، روز را جابه‌جا نکند.

/** «YYYY-MM-DD» میلادی (خروجی PersianDatePicker) → ثانیهٔ یونیکس، ظهر همان روز به وقت محلی؛ نامعتبر → 0 */
export function gregorianDateToUnix(isoDate: string): number {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(isoDate ?? "");
  if (!m) return 0;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return isNaN(d.getTime()) ? 0 : Math.floor(d.getTime() / 1000);
}

/** ثانیه (یا میلی‌ثانیه) یونیکس → «YYYY-MM-DD» میلادی به وقت محلی، برای مقدار PersianDatePicker */
export function unixToGregorianDate(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts > 1e11 ? ts : ts * 1000);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
