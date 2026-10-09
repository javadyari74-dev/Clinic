import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// اجرای مایگریشن‌ها در هر راه‌اندازی (lib/db/src/index.ts): اصلاح‌های یک‌بارهٔ داده
// فقط یک‌بار اجرا می‌شوند، و 0024 idempotent است.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../lib/db/migrations");
const FLAG = "data_fix_adjust_sign_done";
const WHEN_0023 = 1791500000000;

let dbModule: typeof import("@workspace/db");
let sql: typeof import("drizzle-orm").sql;

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "migrations-once-test-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-clinic.db");
  dbModule = await import("@workspace/db");
  sql = (await import("drizzle-orm")).sql;
  await dbModule.runMigrations(MIGRATIONS_DIR);
});

async function insertAdjustPair(patientId: number, x: number, at: number): Promise<number> {
  const { db } = dbModule;
  await db.run(sql`INSERT INTO patient_account_transactions (uuid, patient_id, amount, type, created_at)
    VALUES (${`w-${at}-${x}`}, ${patientId}, ${-x}, 'loyalty_adjust', ${at})`);
  await db.run(sql`INSERT INTO loyalty_transactions (uuid, patient_id, delta, amount, type, created_at)
    VALUES (${`l-${at}-${x}`}, ${patientId}, 1, ${x}, 'adjust', ${at + 2})`);
  const row = await db.all<{ id: number }>(sql`SELECT id FROM loyalty_transactions WHERE uuid = ${`l-${at}-${x}`}`);
  return row[0].id;
}

async function amountOf(id: number): Promise<number> {
  const rows = await dbModule.db.all<{ amount: number }>(sql`SELECT amount FROM loyalty_transactions WHERE id = ${id}`);
  return Number(rows[0].amount);
}

async function newPatient(fileNumber: string): Promise<number> {
  const [p] = await dbModule.db
    .insert(dbModule.patientsTable)
    .values({ name: "آزمایش", phone: "0912", fileNumber })
    .returning();
  return p.id;
}

describe("loyalty adjust sign fix (formerly an UPDATE inside 0023)", () => {
  it("runs once: a legitimate +X/−X adjustment created afterwards stays positive across restarts", async () => {
    const flag = await dbModule.db.all(sql`SELECT key FROM app_settings WHERE key = ${FLAG}`);
    expect(flag).toHaveLength(1);

    const pid = await newPatient("ONCE-1");
    const id = await insertAdjustPair(pid, 5000, 1_790_000_000);
    await dbModule.runMigrations(MIGRATIONS_DIR); // راه‌اندازی دوباره
    await dbModule.runMigrations(MIGRATIONS_DIR);
    expect(await amountOf(id)).toBe(5000);
  });

  it("a database upgrading from before 0023 gets the fix exactly once", async () => {
    const { db } = dbModule;
    // شبیه‌سازی پایگاه داده‌ای که 0023 هنوز روی آن اجرا نشده
    await db.run(sql`DELETE FROM app_settings WHERE key = ${FLAG}`);
    await db.run(sql`DELETE FROM __drizzle_migrations WHERE created_at >= ${WHEN_0023}`);
    const pid = await newPatient("ONCE-2");
    const buggy = await insertAdjustPair(pid, 7000, 1_790_000_100);

    await dbModule.runMigrations(MIGRATIONS_DIR);
    expect(await amountOf(buggy)).toBe(-7000);

    const legit = await insertAdjustPair(pid, 3000, 1_790_000_200);
    await dbModule.runMigrations(MIGRATIONS_DIR);
    expect(await amountOf(buggy)).toBe(-7000);
    expect(await amountOf(legit)).toBe(3000);
  });

  it("a database that already ran the old 0023 is not touched again (only the flag is set)", async () => {
    const { db } = dbModule;
    await db.run(sql`DELETE FROM app_settings WHERE key = ${FLAG}`);
    // 0023 ثبت شده است (اجرای قبلی)، پس UPDATE قدیمی قبلاً اعمال شده
    const pid = await newPatient("ONCE-3");
    const legit = await insertAdjustPair(pid, 4000, 1_790_000_300);
    await dbModule.runMigrations(MIGRATIONS_DIR);
    expect(await amountOf(legit)).toBe(4000);
    expect(await db.all(sql`SELECT key FROM app_settings WHERE key = ${FLAG}`)).toHaveLength(1);
  });
});

describe("migration 0024", () => {
  it("converts appointments stored in seconds to milliseconds, idempotently", async () => {
    const { db } = dbModule;
    const pid = await newPatient("SEC-1");
    const [svc] = await db.insert(dbModule.servicesTable).values({ name: "خدمت", price: 1 }).returning();
    await db.run(sql`INSERT INTO appointments (uuid, patient_id, service_id, scheduled_at, status, created_at)
      VALUES ('appt-sec', ${pid}, ${svc.id}, 1790000000, 'scheduled', 1)`);
    await db.run(sql`INSERT INTO appointments (uuid, patient_id, service_id, scheduled_at, status, created_at)
      VALUES ('appt-ms', ${pid}, ${svc.id}, 1790000000123, 'scheduled', 1)`);
    await dbModule.runMigrations(MIGRATIONS_DIR);
    await dbModule.runMigrations(MIGRATIONS_DIR);
    const rows = await db.all<{ uuid: string; scheduled_at: number }>(
      sql`SELECT uuid, scheduled_at FROM appointments WHERE uuid IN ('appt-sec', 'appt-ms') ORDER BY uuid`,
    );
    expect(rows.map((r) => [r.uuid, Number(r.scheduled_at)])).toEqual([
      ["appt-ms", 1790000000123],
      ["appt-sec", 1790000000000],
    ]);
  });

  it("backfills uuid on legacy laser rows", async () => {
    const { db } = dbModule;
    await db.run(sql`INSERT INTO laser_clients (uuid, file_number, name, phone, gender, created_at)
      VALUES (NULL, 'LZ-LEGACY', 'قدیمی', '1', 'female', 1)`);
    await dbModule.runMigrations(MIGRATIONS_DIR);
    const n = await db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM laser_clients WHERE uuid IS NULL`);
    expect(Number(n[0].n)).toBe(0);
  });
});
