import { DateObject } from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import type { DateRange, ChartPoint } from "@/hooks/use-accounting";

// بازه‌های گزارش حسابداری بر پایهٔ تقویم شمسی و منطقهٔ زمانی همین دستگاه.
// همهٔ مرزها «ابتدای روز محلی» هستند و to انحصاری است (ابتدای روزِ بعد از آخرین روز).

export type RangePreset = "today" | "week" | "month" | "lastMonth" | "year" | "all" | "custom";

export const PRESET_LABELS: Record<Exclude<RangePreset, "custom">, string> = {
  today: "امروز",
  week: "این هفته",
  month: "این ماه",
  lastMonth: "ماه گذشته",
  year: "امسال",
  all: "همه",
};

const DAY_MS = 86_400_000;

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addLocalDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

const toUnix = (d: Date) => Math.floor(d.getTime() / 1000);

function shamsi(d: Date): DateObject {
  return new DateObject({ date: d, calendar: persian, locale: persian_fa });
}

/** بازهٔ شامل روزهای first تا last (هر دو شامل) */
export function rangeFromDays(first: Date, last: Date): DateRange {
  const a = startOfLocalDay(first <= last ? first : last);
  const b = startOfLocalDay(first <= last ? last : first);
  return { from: toUnix(a), to: toUnix(addLocalDays(b, 1)) };
}

export function presetRange(preset: Exclude<RangePreset, "custom">, now = new Date()): DateRange {
  const today = startOfLocalDay(now);
  switch (preset) {
    case "today":
      return rangeFromDays(today, today);
    case "week": {
      // هفتهٔ شمسی از شنبه شروع می‌شود (getDay: شنبه = ۶)
      const sinceSaturday = (today.getDay() + 1) % 7;
      return rangeFromDays(addLocalDays(today, -sinceSaturday), today);
    }
    case "month": {
      const first = shamsi(today).toFirstOfMonth().toDate();
      const last = shamsi(today).toLastOfMonth().toDate();
      return rangeFromDays(first, last);
    }
    case "lastMonth": {
      const prev = shamsi(today).toFirstOfMonth().subtract(1, "day");
      return rangeFromDays(new DateObject(prev).toFirstOfMonth().toDate(), prev.toDate());
    }
    case "year": {
      const first = shamsi(today).toFirstOfYear().toDate();
      const last = shamsi(today).toLastOfYear().toDate();
      return rangeFromDays(first, last);
    }
    case "all":
      return { from: 0, to: toUnix(addLocalDays(today, 1)) };
  }
}

/** «۱ مهر ۱۴۰۵» */
export function formatShamsiDay(d: Date): string {
  return shamsi(d).format("D MMMM YYYY");
}

/** متن بازه، مثلاً «۱ تا ۱۵ مهر ۱۴۰۵» یا «۲۰ شهریور تا ۵ مهر ۱۴۰۵» */
export function formatRangeLabel(range: DateRange): string {
  if (range.from === 0) return "از ابتدا تا امروز";
  const a = shamsi(new Date(range.from * 1000));
  const b = shamsi(new Date((range.to - 1) * 1000));
  if (a.year === b.year && a.month.number === b.month.number) {
    return a.day === b.day ? b.format("D MMMM YYYY") : `${a.format("D")} تا ${b.format("D MMMM YYYY")}`;
  }
  if (a.year === b.year) return `${a.format("D MMMM")} تا ${b.format("D MMMM YYYY")}`;
  return `${a.format("D MMMM YYYY")} تا ${b.format("D MMMM YYYY")}`;
}

export function rangeDays(range: DateRange): number {
  return Math.round((range.to - range.from) / 86400);
}

export interface ChartBucket {
  key: string;
  label: string;
  revenue: number;
  serviceCosts: number;
  expenses: number;
  commissions: number;
  totalCosts: number;
  profit: number;
  /** سود انباشته از ابتدای بازه تا انتهای این ستون */
  cumulativeProfit: number;
}

/** بیشترین تعداد روز برای نمایش روزانه؛ بیشتر از این، ماهانه (شمسی) گروه می‌شود. */
const MAX_DAILY_BUCKETS = 62;

function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * نقاط پراکندهٔ روزانهٔ سرور را به یک سری کامل تبدیل می‌کند: روزهای بی‌داده صفر می‌شوند
 * (تا خط و ستون‌ها روی محور زمان درست قرار بگیرند) و بازه‌های بلند به ماه‌های شمسی گروه می‌شوند.
 */
export function buildChartSeries(points: ChartPoint[], range: DateRange): { buckets: ChartBucket[]; monthly: boolean } {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  // در «همه» از اولین روزِ دارای داده شروع می‌کنیم، نه از ۱۹۷۰
  let start = startOfLocalDay(new Date(range.from * 1000));
  if (sorted.length && parseLocalDate(sorted[0].date) > start && range.from === 0) {
    start = parseLocalDate(sorted[0].date);
  }
  if (range.from === 0 && !sorted.length) return { buckets: [], monthly: false };
  const end = startOfLocalDay(new Date((range.to - 1) * 1000));
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  const monthly = days > MAX_DAILY_BUCKETS;

  const bucketKey = (d: Date) => {
    if (!monthly) return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const s = shamsi(d);
    return `${s.year}-${s.month.number}`;
  };

  const buckets: ChartBucket[] = [];
  const byKey = new Map<string, ChartBucket>();
  for (let d = start; d <= end; d = addLocalDays(d, 1)) {
    const key = bucketKey(d);
    if (byKey.has(key)) continue;
    const b: ChartBucket = {
      key,
      label: monthly ? shamsi(d).format("MMMM YY") : shamsi(d).format("D MMMM"),
      revenue: 0, serviceCosts: 0, expenses: 0, commissions: 0, totalCosts: 0, profit: 0, cumulativeProfit: 0,
    };
    byKey.set(key, b);
    buckets.push(b);
  }

  for (const p of sorted) {
    const b = byKey.get(bucketKey(parseLocalDate(p.date)));
    if (!b) continue;
    b.revenue += p.revenue;
    b.serviceCosts += p.serviceCosts;
    b.expenses += p.expenses;
    b.commissions += p.commissions;
    b.totalCosts += p.totalCosts;
    b.profit += p.profit;
  }

  let running = 0;
  for (const b of buckets) {
    running += b.profit;
    b.cumulativeProfit = running;
  }
  return { buckets, monthly };
}

/** برچسب کوتاه محور عمودی: ۱٫۵M / ۲۵۰K */
export function formatAxisAmount(v: number): string {
  const abs = Math.abs(v);
  let text: string;
  if (abs >= 1_000_000_000) text = `${+(v / 1_000_000_000).toFixed(1)}B`;
  else if (abs >= 1_000_000) text = `${+(v / 1_000_000).toFixed(1)}M`;
  else if (abs >= 1_000) text = `${+(v / 1_000).toFixed(0)}K`;
  else text = String(v);
  return text.replace(/\d/g, (x) => "۰۱۲۳۴۵۶۷۸۹"[Number(x)]).replace(".", "٫");
}
