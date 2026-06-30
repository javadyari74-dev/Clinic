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

const SHAMSI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

// Format a stored birthdate ("YYYY-MM-DD") as a Persian (Shamsi) display string.
// Values are stored in Gregorian by the date picker, so we convert to Shamsi here.
// Legacy values that are already Shamsi (year < 1700) are shown as-is.
export function formatBirthdate(value: string | null | undefined): string {
  if (!value) return "";
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return value;
  const [y, m, d] = parts;
  // Already a Shamsi value stored directly
  if (y < 1700) {
    return `${toPersianDigits(d)} ${SHAMSI_MONTHS[(m - 1) % 12] ?? ""} ${toPersianDigits(y)}`.trim();
  }
  // Gregorian → Shamsi
  const date = new Date(y, m - 1, d, 12, 0, 0);
  if (isNaN(date.getTime())) return value;
  const fmtParts = new Intl.DateTimeFormat("en-US-u-ca-persian", {
    year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(date);
  const get = (t: string) => parseInt(fmtParts.find(p => p.type === t)?.value ?? "0");
  const sy = get("year"), sm = get("month"), sd = get("day");
  return `${toPersianDigits(sd)} ${SHAMSI_MONTHS[(sm - 1) % 12] ?? ""} ${toPersianDigits(sy)}`;
}

// Format Date object to YYYY-MM-DD string for input values
export function toISODateString(date: Date): string {
  return date.toISOString().split('T')[0];
}
