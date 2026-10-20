import { describe, expect, it } from "vitest";
import { lastTehranDaysRevenue } from "@/pages/dashboard";

describe("dashboard revenue sparkline", () => {
  it("covers the last 7 Tehran days with zero fill, not the last 7 entries of a sparse series", () => {
    // ۲۲:۰۰ UTC روز ۱۹ اکتبر = ۰۱:۳۰ تهرانِ ۲۰ اکتبر
    const now = Date.parse("2026-10-19T22:00:00Z");
    const series = [
      { date: "2026-09-01", revenue: 999 },
      { date: "2026-10-01", revenue: 999 },
      { date: "2026-10-14", revenue: 10 },
      { date: "2026-10-18", revenue: 30 },
      { date: "2026-10-20", revenue: 50 },
    ];
    expect(lastTehranDaysRevenue(series, 7, now)).toEqual([10, 0, 0, 0, 30, 0, 50]);
  });
});
