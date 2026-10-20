import { describe, expect, it } from "vitest";
import { firstDirection, sortRows } from "@/hooks/use-table-sort";

const rows = [
  { name: "ملکی", profit: 200, file: "P10" },
  { name: "احمدی", profit: 900, file: "P2" },
  { name: "یاری", profit: null, file: "" },
  { name: "بهرامی", profit: 50, file: "P1" },
];

describe("table sorting", () => {
  it("numbers: first click is largest first, empty values last both ways", () => {
    const get = (r: (typeof rows)[number]) => r.profit;
    expect(firstDirection(rows, get)).toBe("desc");
    expect(sortRows(rows, get, "desc").map((r) => r.profit)).toEqual([900, 200, 50, null]);
    expect(sortRows(rows, get, "asc").map((r) => r.profit)).toEqual([50, 200, 900, null]);
  });

  it("text: Persian alphabetical order, with natural numbers inside text", () => {
    const byName = (r: (typeof rows)[number]) => r.name;
    expect(firstDirection(rows, byName)).toBe("asc");
    expect(sortRows(rows, byName, "asc").map((r) => r.name)).toEqual(["احمدی", "بهرامی", "ملکی", "یاری"]);
    expect(sortRows(rows, byName, "desc").map((r) => r.name)).toEqual(["یاری", "ملکی", "بهرامی", "احمدی"]);
    expect(sortRows(rows, (r) => r.file, "asc").map((r) => r.file)).toEqual(["P1", "P2", "P10", ""]);
  });
});
