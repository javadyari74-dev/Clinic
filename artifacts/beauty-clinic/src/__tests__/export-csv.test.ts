import { describe, it, expect } from "vitest";
import { toCsv, type CsvColumn } from "@/lib/export-csv";

interface Row { name: string; amount: number; note?: string | null }

const cols: CsvColumn<Row>[] = [
  { header: "نام", value: (r) => r.name },
  { header: "مبلغ", value: (r) => r.amount },
  { header: "یادداشت", value: (r) => r.note },
];

describe("toCsv", () => {
  it("starts with a UTF-8 BOM so Excel reads Persian correctly", () => {
    const csv = toCsv(cols, []);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe("نام,مبلغ,یادداشت");
  });

  it("writes numbers raw (no separators or currency) and rows joined by CRLF", () => {
    const csv = toCsv(cols, [{ name: "بوتاکس", amount: 1500000 }, { name: "فیلر", amount: -250 }]);
    const lines = csv.slice(1).split("\r\n");
    expect(lines).toEqual(["نام,مبلغ,یادداشت", "بوتاکس,1500000,", "فیلر,-250,"]);
    expect(csv).not.toContain("تومان");
  });

  it("quotes cells containing commas, quotes or newlines and doubles inner quotes", () => {
    const csv = toCsv(cols, [
      { name: "الف، ب,ج", amount: 1, note: 'گفت "سلام"' },
      { name: "خط\nدوم", amount: 2, note: "a\r\nb" },
    ]);
    const body = csv.slice(1);
    expect(body).toContain('"الف، ب,ج",1,"گفت ""سلام"""');
    expect(body).toContain('"خط\nدوم",2,"a\r\nb"');
  });

  it("renders null/undefined as empty cells", () => {
    const csv = toCsv(cols, [{ name: "x", amount: 0, note: null }]);
    expect(csv.slice(1).split("\r\n")[1]).toBe("x,0,");
  });
});
