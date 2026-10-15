import { describe, expect, it } from "vitest";
import {
  presetRange, rangeFromDays, formatRangeLabel, buildChartSeries, formatAxisAmount,
} from "@/lib/shamsi-range";

const local = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const unix = (d: Date) => Math.floor(d.getTime() / 1000);
// سه‌شنبه ۱۴ مهر ۱۴۰۵ = ۶ اکتبر ۲۰۲۶، ساعت ۱۵
const NOW = new Date(2026, 9, 6, 15, 30);

const point = (date: string, revenue: number, totalCosts = 0) => ({
  date, revenue, serviceCosts: totalCosts, expenses: 0, commissions: 0, totalCosts, profit: revenue - totalCosts,
});

describe("Shamsi presets", () => {
  it("today covers exactly one local day", () => {
    expect(presetRange("today", NOW)).toEqual({ from: unix(local(2026, 10, 6)), to: unix(local(2026, 10, 7)) });
  });

  it("week starts on Saturday", () => {
    expect(presetRange("week", NOW)).toEqual({ from: unix(local(2026, 10, 3)), to: unix(local(2026, 10, 7)) });
  });

  it("this month is 1 to 30 Mehr 1405", () => {
    expect(presetRange("month", NOW)).toEqual({ from: unix(local(2026, 9, 23)), to: unix(local(2026, 10, 23)) });
  });

  it("last month is Shahrivar 1405 (31 days)", () => {
    expect(presetRange("lastMonth", NOW)).toEqual({ from: unix(local(2026, 8, 23)), to: unix(local(2026, 9, 23)) });
  });

  it("this year is Farvardin to Esfand 1405", () => {
    expect(presetRange("year", NOW)).toEqual({ from: unix(local(2026, 3, 21)), to: unix(local(2027, 3, 21)) });
  });
});

describe("range helpers", () => {
  it("accepts days in either order and makes the end inclusive", () => {
    expect(rangeFromDays(local(2026, 10, 5), local(2026, 10, 1))).toEqual({
      from: unix(local(2026, 10, 1)), to: unix(local(2026, 10, 6)),
    });
  });

  it("labels ranges in Shamsi", () => {
    expect(formatRangeLabel(presetRange("month", NOW))).toBe("۱ تا ۳۰ مهر ۱۴۰۵");
    expect(formatRangeLabel(presetRange("today", NOW))).toBe("۱۴ مهر ۱۴۰۵");
    expect(formatRangeLabel(rangeFromDays(local(2026, 9, 11), local(2026, 10, 6)))).toBe("۲۰ شهریور تا ۱۴ مهر ۱۴۰۵");
  });

  it("formats axis amounts compactly with Persian digits", () => {
    expect(formatAxisAmount(1_500_000)).toBe("۱٫۵M");
    expect(formatAxisAmount(250_000)).toBe("۲۵۰K");
    expect(formatAxisAmount(-2_000_000)).toBe("-۲M");
  });
});

describe("buildChartSeries", () => {
  it("fills missing days with zero and accumulates profit", () => {
    const range = rangeFromDays(local(2026, 10, 1), local(2026, 10, 4));
    const { buckets, monthly } = buildChartSeries([point("2026-10-01", 100, 40), point("2026-10-03", 50)], range);
    expect(monthly).toBe(false);
    expect(buckets.map((b) => b.revenue)).toEqual([100, 0, 50, 0]);
    expect(buckets.map((b) => b.cumulativeProfit)).toEqual([60, 60, 110, 110]);
    expect(buckets[0].label).toBe("۹ مهر");
  });

  it("groups long ranges by Shamsi month", () => {
    const { buckets, monthly } = buildChartSeries(
      [point("2026-09-22", 10), point("2026-09-23", 20), point("2026-10-06", 30)],
      presetRange("year", NOW),
    );
    expect(monthly).toBe(true);
    expect(buckets).toHaveLength(12);
    expect(buckets[5].label).toBe("شهریور ۰۵");
    expect(buckets[5].revenue).toBe(10); // ۳۱ شهریور
    expect(buckets[6].revenue).toBe(50); // مهر
  });

  it("starts 'all' from the first day with data", () => {
    const { buckets } = buildChartSeries([point("2026-10-04", 10)], presetRange("all", NOW));
    expect(buckets.map((b) => b.revenue)).toEqual([10, 0, 0]);
  });
});
