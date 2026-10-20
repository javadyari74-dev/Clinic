import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

// ادغام/بازیابی پشتیبان: تداخل کدهای یکتا، نگاشت‌ها، موجودی اکانت، حفظ بخش‌ها،
// اصلاح‌های یک‌بارهٔ داده، نسخهٔ پیش از ارتقا و محافظت /backup/auto.

vi.mock("../src/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../lib/db/migrations");

let dbModule: typeof import("@workspace/db");
let backupService: typeof import("../src/lib/backup-service");
let server: http.Server;
let base: string;
let adminToken = "";
let tmpDir = "";

// خدمت شهریور (۷ شهریور ۱۴۰۵)، پرداخت ۳۰ روز بعد (مهر)
const SVC_AT = 1_788_000_000;
const LATE_PAID_AT = SVC_AT + 30 * 86_400;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-fixes-test-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "clinic.db");
  dbModule = await import("@workspace/db");
  await dbModule.runMigrations(MIGRATIONS_DIR);
  backupService = await import("../src/lib/backup-service");
  const auth = await import("../src/lib/auth");
  const { default: router } = await import("../src/routes");
  const [u] = await dbModule.db
    .insert(dbModule.usersTable)
    .values({ username: "boss", password: "x", role: "admin", permissions: "[]", isActive: true })
    .returning();
  adminToken = auth.signToken({ sub: u.id, username: "boss", role: "admin", permissions: [] });
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api", router);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function call(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { authorization: `Bearer ${adminToken}`, ...headers };
  if (body) h["content-type"] = "application/json";
  const res = await fetch(`${base}${p}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, json };
}

describe("merge: unique codes generated independently on each device", () => {
  it("suffixes colliding service codes, file numbers and discount codes; maps same purchase product", async () => {
    const { db, servicesTable, patientsTable, discountsTable, purchaseProductsTable } = dbModule;
    const { eq } = await import("drizzle-orm");
    await db.insert(servicesTable).values({ name: "خدمت محلی", price: 1, serviceCode: "SRV-0001" });
    await db.insert(patientsTable).values({ name: "محلی", phone: "1", fileNumber: "441" });
    await db.insert(discountsTable).values({ name: "تخفیف محلی", code: "OFF10", type: "percent", value: 10 } as any);
    await db.insert(purchaseProductsTable).values({ productType: "فیلر", name: "لوناژل" });

    const payload = {
      data: {
        services: [{ id: 1, uuid: "svc-remote-code", name: "خدمت دیگر", price: 2, serviceCode: "SRV-0001", createdAt: 1 }],
        patients: [{ id: 1, uuid: "pat-remote-441", name: "دیگر", phone: "2", fileNumber: "441", createdAt: 1 }],
        discounts: [{ id: 1, uuid: "disc-remote", name: "تخفیف دیگر", code: "OFF10", type: "percent", value: 5, createdAt: 1 }],
        purchaseProducts: [
          { id: 1, uuid: "pp-remote-same", productType: "فیلر", name: "لوناژل", createdAt: 1 },
          { id: 2, uuid: "pp-remote-new", productType: "فیلر", name: "رووفیل", createdAt: 1 },
        ],
      },
    };
    const { report } = await backupService.mergeRestore(payload);
    expect(report.services.added).toBe(1);
    expect(report.patients.added).toBe(1);
    expect(report.discounts.added).toBe(1);
    expect(report.purchaseProducts).toMatchObject({ added: 1, skipped: 1 });

    const svc = await db.select().from(servicesTable).where(eq(servicesTable.uuid, "svc-remote-code")).get();
    const pat = await db.select().from(patientsTable).where(eq(patientsTable.uuid, "pat-remote-441")).get();
    const disc = await db.select().from(discountsTable).where(eq(discountsTable.uuid, "disc-remote")).get();
    expect(svc?.serviceCode).toBe("SRV-0001-۲");
    expect(pat?.fileNumber).toBe("441-۲");
    expect(disc?.code).toBe("OFF10-۲");
    const products = await db.select().from(purchaseProductsTable);
    expect(products.filter((p) => p.name === "لوناژل")).toHaveLength(1);

    // دوباره: تکراری بر اساس uuid، بدون خطا
    const again = await backupService.mergeRestore(payload);
    expect(again.report.totals.added).toBe(0);
  });

  it("the merge route also handles a code that already carries a suffix", async () => {
    const r = await call("POST", "/backup/merge", {
      data: { services: [{ id: 9, uuid: "svc-x", name: "x", price: 1, serviceCode: "SRV-0001-۲", createdAt: 1 }] },
    });
    expect(r.status).toBe(200);
    expect(r.json.report.services.added).toBe(1);
    const { eq } = await import("drizzle-orm");
    const row = await dbModule.db.select().from(dbModule.servicesTable).where(eq(dbModule.servicesTable.uuid, "svc-x")).get();
    expect(row?.serviceCode).toBe("SRV-0001-۲-۲");
  });
});

describe("merge: references and balances", () => {
  it("remaps reminders.paymentId and recomputes account balance of existing patients", async () => {
    const { db, patientsTable, servicesTable, appointmentsTable, paymentsTable, remindersTable, patientAccountTransactionsTable } = dbModule;
    const { eq } = await import("drizzle-orm");
    // مراجع موجود با موجودی ۱۰۰۰ (یک تراکنش)
    const [p] = await db
      .insert(patientsTable)
      .values({ uuid: "pat-bal", name: "موجودی", phone: "3", fileNumber: "BAL-1", accountBalance: 1000 })
      .returning();
    await db.insert(patientAccountTransactionsTable).values({ patientId: p.id, amount: 1000, type: "deposit", description: "x" });
    // ردیف‌های محلی تا شناسه‌های فایل با شناسه‌های تازه فرق کنند
    const [s] = await db.insert(servicesTable).values({ name: "پرکننده", price: 1 }).returning();
    const [a] = await db.insert(appointmentsTable).values({ patientId: p.id, serviceId: s.id, scheduledAt: 1_790_000_000_000, status: "completed" } as any).returning();
    await db.insert(paymentsTable).values({ appointmentId: a.id, originalAmount: 1, amount: 1, method: "cash", paidAt: 1_790_000_000 } as any);

    await backupService.mergeRestore({
      dataFixes: [...Object.keys(backupService.DATA_FIX_INTRODUCED_AT)],
      data: {
        patients: [{ id: 1, uuid: "pat-bal", name: "موجودی", phone: "3", fileNumber: "BAL-1", accountBalance: 1500, createdAt: 1 }],
        services: [{ id: 1, uuid: "svc-rem", name: "خدمت یادآوری", price: 1, createdAt: 1 }],
        appointments: [{ id: 1, uuid: "appt-rem", patientId: 1, serviceId: 1, scheduledAt: 1_790_000_000_000, status: "completed", createdAt: 1 }],
        payments: [{ id: 1, uuid: "pay-rem", appointmentId: 1, originalAmount: 500, amount: 500, method: "cash", paidAt: 1_790_000_000, createdAt: 1 }],
        accountTransactions: [{ id: 7, uuid: "txn-new", patientId: 1, amount: 500, type: "deposit", description: "y", createdAt: 1 }],
        reminders: [{ id: 1, uuid: "rem-1", title: "پیگیری", type: "follow_up", patientId: 1, paymentId: 1, dueAt: 1_790_000_000, status: "pending", createdAt: 1 }],
      },
    });
    const pay = await db.select().from(paymentsTable).where(eq(paymentsTable.uuid, "pay-rem")).get();
    const rem = await db.select().from(remindersTable).where(eq(remindersTable.uuid, "rem-1")).get();
    expect(pay).toBeTruthy();
    expect(rem?.paymentId).toBe(pay!.id);
    expect(rem?.patientId).toBe(p.id);
    const after = await db.select().from(patientsTable).where(eq(patientsTable.id, p.id)).get();
    expect(after?.accountBalance).toBe(1500);
  });

  it("moves late payments of an old backup to the service month, but not those of a current one", async () => {
    const { db, paymentsTable } = dbModule;
    const { eq } = await import("drizzle-orm");
    const file = (suffix: string) => ({
      services: [{ id: 1, uuid: `svc-late-${suffix}`, name: `خدمت ${suffix}`, price: 1, createdAt: 1 }],
      patients: [{ id: 1, uuid: `pat-late-${suffix}`, name: "دیر", phone: "4", fileNumber: `LATE-${suffix}`, createdAt: 1 }],
      appointments: [{ id: 1, uuid: `appt-late-${suffix}`, patientId: 1, serviceId: 1, scheduledAt: SVC_AT * 1000, status: "completed", createdAt: 1 }],
      payments: [{ id: 1, uuid: `pay-late-${suffix}`, appointmentId: 1, originalAmount: 1, amount: 1, method: "cash", paidAt: LATE_PAID_AT, createdAt: 1 }],
    });
    await backupService.mergeRestore({ exportedAt: "2026-10-01T00:00:00.000Z", data: file("old") });
    await backupService.mergeRestore({ dataFixes: [...Object.keys(backupService.DATA_FIX_INTRODUCED_AT)], data: file("new") });
    const oldPay = await db.select().from(paymentsTable).where(eq(paymentsTable.uuid, "pay-late-old")).get();
    const newPay = await db.select().from(paymentsTable).where(eq(paymentsTable.uuid, "pay-late-new")).get();
    expect(oldPay?.paidAt).toBe(SVC_AT);
    expect(newPay?.paidAt).toBe(LATE_PAID_AT);
  });
});

describe("full restore", () => {
  const minimal = (extra: Record<string, unknown> = {}) => ({
    version: 8,
    exportedAt: new Date().toISOString(),
    dataFixes: [...Object.keys(backupService.DATA_FIX_INTRODUCED_AT)],
    data: {
      patients: [{ id: 1, uuid: "p-full-1", name: "الف", phone: "1", fileNumber: "FR-1", createdAt: 1 }],
      services: [{ id: 1, uuid: "s-full-1", name: "خدمت", price: 10, createdAt: 1 }],
      ...extra,
    },
  });

  it("rejects files without a version or without patients/services, before touching data", async () => {
    const before = (await dbModule.db.select().from(dbModule.patientsTable)).length;
    const noVersion = await call("POST", "/backup/restore", { data: minimal().data });
    expect(noVersion.status).toBe(400);
    expect(noVersion.json.error).toMatch(/نسخه/);
    const noServices = await call("POST", "/backup/restore", { version: 8, data: { patients: [] } });
    expect(noServices.status).toBe(400);
    const future = await call("POST", "/backup/restore", { ...minimal(), version: 99 });
    expect(future.status).toBe(400);
    expect((await dbModule.db.select().from(dbModule.patientsTable)).length).toBe(before);
  });

  it("takes a pre-restore safety backup, keeps purchases and scheduled SMS when absent, rebuilds price history", async () => {
    const { db, purchasesTable, purchaseProductsTable, scheduledSmsTable, servicePriceHistoryTable } = dbModule;
    await db.insert(purchasesTable).values({ productType: "فیلر", productName: "لوناژل", price: 100, purchaseDate: 1_790_000_000 });
    await db.insert(scheduledSmsTable).values({ key: "birthday:1:1405", kind: "birthday", status: "sent" });
    const productsBefore = (await db.select().from(purchaseProductsTable)).length;

    const r = await call("POST", "/backup/restore", minimal());
    expect(r.status).toBe(200);
    expect(r.json.safetyBackup).toMatch(/^auto-/);
    const logs = await backupService.getBackupLogs(5);
    expect(logs.some((l) => l.kind === "pre-restore" && l.status === "success")).toBe(true);

    expect(await db.select().from(purchasesTable)).toHaveLength(1);
    expect(await db.select().from(purchaseProductsTable)).toHaveLength(productsBefore);
    const sched = await db.select().from(scheduledSmsTable);
    expect(sched.map((x) => x.key)).toContain("birthday:1:1405");
    const history = await db.select().from(servicePriceHistoryTable);
    expect(history.map((h) => h.serviceId)).toEqual([1]);

    // فایل دارای بخش خریدها جایگزینشان می‌کند
    const r2 = await call("POST", "/backup/restore", minimal({ purchases: [] }));
    expect(r2.status).toBe(200);
    expect(await db.select().from(purchasesTable)).toHaveLength(0);
  });

  it("aborts with a Persian error when the safety backup cannot be written", async () => {
    const blocker = path.join(tmpDir, "blocker-file");
    fs.writeFileSync(blocker, "x");
    await backupService.setSetting("backup_dir", path.join(blocker, "sub"));
    const r = await call("POST", "/backup/restore", minimal());
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/بکاپ ایمنی/);
    await backupService.setSetting("backup_dir", "");
  });

  it("runs the one-time fixes on data restored from an older backup only", async () => {
    const { db, paymentsTable, appSettingsTable } = dbModule;
    const { eq } = await import("drizzle-orm");
    const late = {
      appointments: [{ id: 1, uuid: "a-fix", patientId: 1, serviceId: 1, scheduledAt: SVC_AT * 1000, status: "completed", createdAt: 1 }],
      payments: [{ id: 1, uuid: "pay-fix", appointmentId: 1, originalAmount: 10, amount: 10, method: "cash", paidAt: LATE_PAID_AT, createdAt: 1 }],
    };
    // فایل فعلی (همهٔ اصلاح‌ها را گرفته): پرداخت دیرهنگامِ واقعی دست نمی‌خورد
    expect((await call("POST", "/backup/restore", minimal(late))).status).toBe(200);
    expect((await db.select().from(paymentsTable).where(eq(paymentsTable.id, 1)).get())?.paidAt).toBe(LATE_PAID_AT);

    // فایل قدیمی (پیش از اصلاح، بدون فهرست dataFixes): اصلاح اجرا می‌شود
    const old = { ...minimal(late), exportedAt: "2026-10-01T00:00:00.000Z" } as Record<string, unknown>;
    delete old.dataFixes;
    expect((await call("POST", "/backup/restore", old)).status).toBe(200);
    expect((await db.select().from(paymentsTable).where(eq(paymentsTable.id, 1)).get())?.paidAt).toBe(SVC_AT);
    const flag = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, "data_fix_payments_to_service_month")).get();
    expect(flag).toBeTruthy();
  });

  it("exports the applied one-time fixes with the backup", async () => {
    const b = await backupService.buildBackupData();
    expect(b.dataFixes).toContain("data_fix_payments_to_service_month");
    expect(b.dataFixes).toContain("data_fix_adjust_sign_done");
  });
});

describe("dataFixesAppliedIn", () => {
  it("uses the exported list, else the export time, else assumes applied", () => {
    expect([...backupService.dataFixesAppliedIn({ dataFixes: ["data_fix_x", 3, "other"] })]).toEqual(["data_fix_x"]);
    const early = backupService.dataFixesAppliedIn({ exportedAt: "2026-10-10T00:00:00.000Z" });
    expect(early.has("data_fix_adjust_sign_done")).toBe(true);
    expect(early.has("data_fix_payments_to_service_month")).toBe(false);
    const unknown = backupService.dataFixesAppliedIn({});
    expect(unknown.has("data_fix_payments_to_service_month")).toBe(true);
  });
});

describe("safety copies and atomic backup files", () => {
  it("copies clinic.db before pending migrations and keeps the last 3", async () => {
    const { db, snapshotBeforeMigrations } = dbModule;
    const { sql } = await import("drizzle-orm");
    // هیچ چیز در انتظار نیست → بدون نسخه
    expect((await snapshotBeforeMigrations(MIGRATIONS_DIR)).path).toBeNull();

    for (const t of ["2020-01-01_00-00-00", "2020-01-02_00-00-00", "2020-01-03_00-00-00"]) {
      fs.writeFileSync(path.join(tmpDir, `clinic.pre-upgrade-${t}.db`), "old");
    }
    // یک مایگریشنِ ثبت‌نشده (مثل نسخهٔ تازهٔ برنامه)
    await db.run(sql`DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MAX(created_at) FROM __drizzle_migrations)`);
    const snap = await snapshotBeforeMigrations(MIGRATIONS_DIR);
    expect(snap.error).toBeUndefined();
    expect(snap.path).toBeTruthy();
    expect(fs.statSync(snap.path!).size).toBeGreaterThan(1000);
    const copies = fs.readdirSync(tmpDir).filter((f) => f.startsWith("clinic.pre-upgrade-"));
    expect(copies).toHaveLength(3);
    expect(copies).not.toContain("clinic.pre-upgrade-2020-01-01_00-00-00.db");
    await dbModule.runMigrations(MIGRATIONS_DIR);
  });

  it("leaves no temporary files behind in the main and mirror folders", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "backup-atomic-"));
    await backupService.setSetting("backup_dir", path.join(root, "main"));
    await backupService.setSetting(backupService.BACKUP_MIRROR_DIR_KEY, path.join(root, "mirror"));
    const r = await backupService.runAutoBackup({ reason: "manual", force: true });
    expect(r.ok).toBe(true);
    for (const d of ["main", "mirror"]) {
      const files = fs.readdirSync(path.join(root, d));
      expect(files).toEqual([r.filename]);
      JSON.parse(fs.readFileSync(path.join(root, d, r.filename!), "utf8"));
    }
    await backupService.setSetting(backupService.BACKUP_MIRROR_DIR_KEY, "");
    await backupService.setSetting("backup_dir", "");
  });
});

describe("POST /backup/auto (desktop shell only)", () => {
  it("requires the shared trigger token and rejects browser requests", async () => {
    const token = "t".repeat(64);
    process.env.BACKUP_TRIGGER_TOKEN = token;
    const post = async (headers: Record<string, string>) => {
      const res = await fetch(`${base}/backup/auto`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ reason: "auto" }),
      });
      await res.text();
      return res.status;
    };
    expect(await post({})).toBe(403);
    expect(await post({ "x-backup-trigger-token": "wrong" })).toBe(403);
    expect(await post({ "x-backup-trigger-token": token, origin: "http://evil.example" })).toBe(403);
    expect(await post({ "x-backup-trigger-token": token })).toBe(200);
    delete process.env.BACKUP_TRIGGER_TOKEN;
    expect(await post({ "x-backup-trigger-token": token })).toBe(403);
  });
});
