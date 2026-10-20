import { describe, expect, it } from "vitest";
import { previousRange } from "@/pages/accounting";
import { presetRange, rangeFromDays } from "@/lib/shamsi-range";

const local = (y: number, m: number, d: number) => new Date(y, m - 1, d);

// مقایسه با دورهٔ قبل: دورهٔ در جریان با همان مقدار سپری‌شده از دورهٔ قبل
describe("accounting previous-period comparison", () => {
  it("3 Aban compares with 1–3 Mehr, not the whole of Mehr", () => {
    const now = new Date(2026, 9, 25, 10); // ۳ آبان ۱۴۰۵
    const prev = previousRange("month", presetRange("month", now), now)!;
    expect(prev.range).toEqual(rangeFromDays(local(2026, 9, 23), local(2026, 9, 25))); // ۱ تا ۳ مهر
    expect(prev.label).toBe("۱ تا ۳ مهر");
  });

  it("on the last day of the month compares with the whole previous month", () => {
    const now = new Date(2026, 10, 21, 10); // ۳۰ آبان ۱۴۰۵
    const prev = previousRange("month", presetRange("month", now), now)!;
    expect(prev.range).toEqual(rangeFromDays(local(2026, 9, 23), local(2026, 10, 22)));
    expect(prev.label).toBe("مهر");
  });

  it("last month compares with the whole month before it", () => {
    const now = new Date(2026, 9, 25, 10);
    const prev = previousRange("lastMonth", presetRange("lastMonth", now), now)!;
    expect(prev.label).toBe("شهریور");
  });

  it("Saturday–Tuesday compares with the previous Saturday–Tuesday", () => {
    const now = new Date(2026, 9, 6, 15); // سه‌شنبه ۱۴ مهر
    const prev = previousRange("week", presetRange("week", now), now)!;
    expect(prev.range).toEqual(rangeFromDays(local(2026, 9, 26), local(2026, 9, 29)));
    expect(prev.label).toBe("همین روزهای هفتهٔ قبل");
  });

  it("this year so far compares with the same stretch of last year", () => {
    const now = new Date(2026, 9, 6, 15); // ۱۴ مهر ۱۴۰۵ = روز ۱۹۸ سال
    const prev = previousRange("year", presetRange("year", now), now)!;
    // ۱ فروردین ۱۴۰۴ = ۲۱ مارس ۲۰۲۵ → ۱۴ مهر ۱۴۰۴ = ۶ اکتبر ۲۰۲۵
    expect(prev.range).toEqual(rangeFromDays(local(2025, 3, 21), local(2025, 10, 6)));
    expect(prev.label).toBe("همین مدت در سال ۱۴۰۴");
  });
});
