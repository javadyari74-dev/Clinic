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
