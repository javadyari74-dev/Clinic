import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// تعمیر سررسید یادآوری‌هایی که با باگ «تاریخ میلادی به‌عنوان شمسی» ذخیره شده بودند.

vi.mock("../src/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../lib/db/migrations");

// کپی دقیق تابع قدیمی shamsiStringToUnix در صفحهٔ صندوق/یادآوری‌ها (قبل از اصلاح)
// که ورودی میلادیِ PersianDatePicker را شمسی فرض می‌کرد.
function buggyShamsiStringToUnix(shamsiStr: string): number {
  const [y, m, day] = shamsiStr.split("-").map(Number);
  const ref = new Date();
  ref.setHours(12, 0, 0, 0);
  const rp = new Intl.DateTimeFormat("en-US-u-ca-persian", { year: "numeric", month: "numeric", day: "numeric" }).formatToParts(ref);
  const rg = (t: string) => parseInt(rp.find((p) => p.type === t)?.value ?? "0");
  const approx = Math.round((y - rg("year")) * 365.25 + ((m - 1) * 30.5 + day) - ((rg("month") - 1) * 30.5 + rg("day")));
  const base = new Date(ref);
  base.setDate(base.getDate() + approx);
  for (let offset = -8; offset <= 8; offset++) {
    const test = new Date(base);
    test.setDate(test.getDate() + offset);
    const tp = new Intl.DateTimeFormat("en-US-u-ca-persian", { year: "numeric", month: "numeric", day: "numeric" }).formatToParts(test);
    const tg = (t: string) => parseInt(tp.find((p) => p.type === t)?.value ?? "0");
    if (tg("year") === y && tg("month") === m && tg("day") === day) return Math.floor(test.getTime() / 1000);
  }
  return Math.floor(base.getTime() / 1000);
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

let backfill: typeof import("../src/lib/backfill");
let dbm: typeof import("@workspace/db");

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reminder-repair-test-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-clinic.db");
  dbm = await import("@workspace/db");
  await dbm.runMigrations(MIGRATIONS_DIR);
  backfill = await import("../src/lib/backfill");
});

describe("repairedReminderDueAt", () => {
  it("recovers the intended day for every day of 1404–1406", () => {
    const wrong: string[] = [];
    const offBy: number[] = [];
    for (let d = new Date(2025, 2, 21, 12); d < new Date(2028, 2, 20); d.setDate(d.getDate() + 1)) {
      const intended = iso(d);
      const broken = buggyShamsiStringToUnix(intended);
      expect(new Date(broken * 1000).getFullYear()).toBeGreaterThan(2500);
      const fixed = backfill.repairedReminderDueAt(broken);
      expect(fixed).not.toBeNull();
      if (iso(new Date(fixed! * 1000)) !== intended) {
        wrong.push(intended);
        offBy.push(Math.round((fixed! * 1000 - d.getTime()) / 86_400_000));
      }
    }
    // روزهایی که در ماه شمسی هم‌شماره وجود ندارند (۳۱ ماه‌های ۷ تا ۱۲ میلادی و ۳۰ دسامبر در
    // سال غیرکبیسه) را تابع قدیمی پیدا نمی‌کرد و فقط یک تخمین (وابسته به روز ثبت) ذخیره می‌کرد؛
    // آن‌ها دقیق قابل بازیابی نیستند و تا حدود ده روز جابه‌جا می‌شوند. بقیهٔ روزها دقیقاً درست برمی‌گردند.
    expect(wrong.every((w) => /-(07|08|09|10|11|12)-3[01]$/.test(w))).toBe(true);
    expect(Math.max(...offBy.map(Math.abs))).toBeLessThanOrEqual(12);
  });

  it("leaves normal dates and millisecond timestamps alone", () => {
    expect(backfill.repairedReminderDueAt(Math.floor(Date.now() / 1000))).toBeNull();
    expect(backfill.repairedReminderDueAt(Date.now())).toBeNull();
  });
});

describe("repairShamsiReminderDates", () => {
  it("fixes broken rows once and keeps valid ones", async () => {
    const good = Math.floor(new Date(2026, 10, 5, 12).getTime() / 1000);
    await dbm.db.insert(dbm.remindersTable).values([
      { title: "خراب", type: "followup", status: "pending", dueAt: buggyShamsiStringToUnix("2026-11-05") },
      { title: "سالم", type: "followup", status: "pending", dueAt: good },
    ]);

    expect(await backfill.repairShamsiReminderDates()).toBe(1);
    expect(await backfill.repairShamsiReminderDates()).toBe(0);

    const rows = await dbm.db.select().from(dbm.remindersTable).all();
    const byTitle = Object.fromEntries(rows.map((r) => [r.title, r.dueAt]));
    expect(iso(new Date(byTitle["خراب"] * 1000))).toBe("2026-11-05"); // ۱۴ آبان ۱۴۰۵
    expect(byTitle["سالم"]).toBe(good);
  });
});
