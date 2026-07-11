import { describe, expect, it, vi } from "vitest";

// sms.ts pulls in the DB and logger at module load; stub both so the pure
// helpers can be tested without a real SQLite connection or pino worker.
vi.mock("../src/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@workspace/db", () => ({
  db: {},
  appSettingsTable: {},
  smsLogTable: {},
}));

import {
  renderTemplate,
  normalizePhone,
  toPersianDigits,
  formatToman,
  formatShamsiDateForSms,
  formatTimeForSms,
  DEFAULT_TEMPLATES,
  sanitizePatternArg,
  buildPatternText,
  PATTERN_VAR_ORDER,
} from "../src/lib/sms";

describe("renderTemplate", () => {
  it("replaces known placeholders and leaves unknown ones intact", () => {
    const out = renderTemplate("سلام {نام}، مبلغ {مبلغ} — {ناشناخته}", {
      "نام": "مریم",
      "مبلغ": "۵۰۰",
    });
    expect(out).toBe("سلام مریم، مبلغ ۵۰۰ — {ناشناخته}");
  });

  it("renders every default template without leftover known placeholders", () => {
    const vars = {
      "نام": "x", "تاریخ": "x", "ساعت": "x", "مبلغ": "x",
      "خدمت": "x", "درصد": "x", "پورسانت": "x",
    };
    for (const tpl of Object.values(DEFAULT_TEMPLATES)) {
      const out = renderTemplate(tpl, vars);
      for (const key of Object.keys(vars)) {
        expect(out).not.toContain(`{${key}}`);
      }
    }
  });
});

describe("normalizePhone", () => {
  it("accepts the canonical 09xxxxxxxxx form", () => {
    expect(normalizePhone("09123456789")).toBe("09123456789");
  });

  it("normalizes +98 / 0098 / 98 / bare-9 prefixes", () => {
    expect(normalizePhone("+989123456789")).toBe("09123456789");
    expect(normalizePhone("00989123456789")).toBe("09123456789");
    expect(normalizePhone("989123456789")).toBe("09123456789");
    expect(normalizePhone("9123456789")).toBe("09123456789");
  });

  it("converts Persian digits and strips separators", () => {
    expect(normalizePhone("۰۹۱۲۳۴۵۶۷۸۹")).toBe("09123456789");
    expect(normalizePhone("0912-345 6789")).toBe("09123456789");
  });

  it("rejects invalid inputs", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("021555555")).toBeNull();
    expect(normalizePhone("0912345678")).toBeNull(); // too short
  });
});

describe("number formatting", () => {
  it("converts to Persian digits", () => {
    expect(toPersianDigits(1234)).toBe("۱۲۳۴");
  });

  it("formats toman amounts with thousands separators", () => {
    expect(formatToman(2500000)).toBe("۲,۵۰۰,۰۰۰");
  });
});

describe("pattern (BaseServiceNumber) helpers", () => {
  it("sanitizes semicolons and newlines out of pattern args", () => {
    expect(sanitizePatternArg("لیزر؛ ناحیه; صورت")).toBe("لیزر؛ ناحیه، صورت");
    expect(sanitizePatternArg("خط\r\nجدید")).toBe("خط جدید");
    expect(sanitizePatternArg("  فاصله  ")).toBe("فاصله");
  });

  it("joins args with semicolons in order", () => {
    expect(buildPatternText(["مریم", "۱۲ تیر", "۱۰:۳۰"])).toBe("مریم;۱۲ تیر;۱۰:۳۰");
  });

  it("keeps a semicolon-containing arg as a single variable", () => {
    expect(buildPatternText(["الف;ب", "ج"]).split(";")).toHaveLength(2);
  });

  it("documents a fixed variable order per event", () => {
    expect(PATTERN_VAR_ORDER.appointment).toEqual(["نام", "تاریخ", "ساعت"]);
    expect(PATTERN_VAR_ORDER.payment).toEqual(["نام", "مبلغ", "خدمت"]);
    expect(PATTERN_VAR_ORDER.commission).toEqual(["نام", "پورسانت", "درصد", "مبلغ"]);
    expect(PATTERN_VAR_ORDER.birthday).toEqual(["نام"]);
  });
});

describe("shamsi date formatting (ms/sec auto-detect)", () => {
  // 2026-07-10T09:30:00Z == 1783416600 (sec) — a fixed known instant.
  const sec = Date.UTC(2026, 6, 10, 9, 30, 0) / 1000;

  it("treats second and millisecond timestamps identically", () => {
    expect(formatShamsiDateForSms(sec)).toBe(formatShamsiDateForSms(sec * 1000));
    expect(formatTimeForSms(sec)).toBe(formatTimeForSms(sec * 1000));
  });

  it("renders a Persian month name and Persian digits", () => {
    const out = formatShamsiDateForSms(sec);
    expect(out).toMatch(/[۰-۹]+ (تیر|خرداد) [۰-۹]{4}/);
  });
});
