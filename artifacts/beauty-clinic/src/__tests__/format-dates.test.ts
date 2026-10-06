import { describe, expect, it } from "vitest";
import { gregorianDateToUnix, unixToGregorianDate, formatShamsiDate } from "@/lib/format";

// PersianDatePicker مقدار میلادی YYYY-MM-DD برمی‌گرداند؛ ۱۴ آبان ۱۴۰۵ = 2026-11-05
describe("PersianDatePicker value helpers", () => {
  it("converts the picker's Gregorian value to local noon (not a Shamsi reinterpretation)", () => {
    const ts = gregorianDateToUnix("2026-11-05");
    expect(ts).toBe(Math.floor(new Date(2026, 10, 5, 12).getTime() / 1000));
    expect(formatShamsiDate(ts)).toBe("۱۴ آبان ۱۴۰۵");
  });

  it("round-trips", () => {
    expect(unixToGregorianDate(gregorianDateToUnix("2027-03-20"))).toBe("2027-03-20");
    expect(unixToGregorianDate(new Date(2026, 10, 5, 23, 59).getTime())).toBe("2026-11-05");
  });

  it("rejects empty or malformed input", () => {
    expect(gregorianDateToUnix("")).toBe(0);
    expect(gregorianDateToUnix("1405/08/14")).toBe(0);
    expect(unixToGregorianDate(0)).toBe("");
  });
});
