import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// backup-service logs through ../src/lib/logger; mock it so tests never spin
// up pino's transport worker.
vi.mock("../src/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../lib/db/migrations");

// The whole suite runs against a throwaway SQLite database in a temp dir so it
// never touches the development clinic.db. SQLITE_DB_PATH must be set before
// @workspace/db is imported, so all imports below are dynamic.
let backupService: typeof import("../src/lib/backup-service");
let dbModule: typeof import("@workspace/db");

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-service-test-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-clinic.db");

  dbModule = await import("@workspace/db");
  await dbModule.runMigrations(MIGRATIONS_DIR);
  backupService = await import("../src/lib/backup-service");
});

// Every section the manual download, auto backup, and pre-merge safety backup
// must all contain — the canonical schema of a version-4 backup file.
const EXPECTED_SECTIONS = [
  "patients",
  "services",
  "staff",
  "appointments",
  "payments",
  "discounts",
  "inventory",
  "commissions",
  "recipients",
  "reminders",
  "notes",
  "activityLog",
  "expenses",
  "users",
  "accountTransactions",
  "laserClients",
  "laserServices",
  "laserAppointments",
  "laserPayments",
  "laserSettings",
  "waitingList",
  "surveys",
  "smsLog",
  "loyaltyTransactions",
];

describe("buildBackupData (single source for manual, auto and pre-merge backups)", () => {
  it("includes every current domain, including the newly ported ones", async () => {
    const backup = await backupService.buildBackupData();
    expect(backup.version).toBe(backupService.BACKUP_VERSION);
    expect(backup.version).toBe(4);
    expect(Object.keys(backup.data).sort()).toEqual([...EXPECTED_SECTIONS].sort());
  });

  it("writes the same schema to disk for auto backups", async () => {
    const result = await backupService.runAutoBackup({ reason: "test", force: true });
    expect(result.ok).toBe(true);
    const dir = await backupService.getBackupDir();
    const written = JSON.parse(
      fs.readFileSync(path.join(dir, result.filename!), "utf-8"),
    );
    expect(written.version).toBe(4);
    expect(Object.keys(written.data).sort()).toEqual([...EXPECTED_SECTIONS].sort());
  });
});

describe("legacy rows without uuid (created before migration 0012)", () => {
  it("are backfilled by migration replay so exports stay mergeable", async () => {
    const { db } = dbModule;
    const { sql } = await import("drizzle-orm");

    // Simulate a legacy row that predates the uuid column: insert with an
    // explicit NULL uuid, bypassing the application-level $defaultFn.
    await db.run(
      sql`INSERT INTO patients (uuid, file_number, name, phone, created_at)
          VALUES (NULL, 'P-LEGACY-1', 'بیمار قدیمی', '09121111111', 1600000000)`,
    );

    // Startup replays all migrations; 0019 backfills NULL uuids idempotently.
    await dbModule.runMigrations(MIGRATIONS_DIR);

    const nullCount = await db.get<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM patients WHERE uuid IS NULL`,
    );
    expect(nullCount?.n).toBe(0);

    // The export therefore carries a uuid on every record, and merging that
    // export back is accepted by preValidate instead of being rejected.
    const backup = await backupService.buildBackupData();
    for (const row of backup.data.patients as Array<{ uuid?: unknown }>) {
      expect(typeof row.uuid).toBe("string");
      expect((row.uuid as string).length).toBeGreaterThan(0);
    }
    const { report } = await backupService.mergeRestore({ data: backup.data });
    // Merging a database into itself must not duplicate anything.
    expect(report.patients.added).toBe(0);
  });
});

describe("mergeRestore covers the newly ported domains", () => {
  it("merges waiting list, surveys and loyalty transactions with remapped FKs, and reports ignored sections", async () => {
    const patientUuid = "patient-uuid-1";
    const serviceUuid = "service-uuid-1";
    const payload = {
      data: {
        patients: [
          {
            id: 501,
            uuid: patientUuid,
            fileNumber: "P-501",
            name: "بیمار آزمایشی",
            phone: "09120000000",
            createdAt: 1_700_000_000,
          },
        ],
        services: [
          {
            id: 601,
            uuid: serviceUuid,
            name: "خدمت آزمایشی",
            price: 100000,
            createdAt: 1_700_000_000,
          },
        ],
        waitingList: [
          {
            id: 701,
            uuid: "waiting-uuid-1",
            patientId: 501,
            serviceId: 601,
            status: "waiting",
            createdAt: 1_700_000_100,
          },
        ],
        surveys: [
          {
            id: 801,
            uuid: "survey-uuid-1",
            patientId: 501,
            sentAt: 1_700_000_200,
            smsStatus: "sent",
            score: 5,
            createdAt: 1_700_000_200,
          },
        ],
        loyaltyTransactions: [
          {
            id: 901,
            uuid: "loyalty-uuid-1",
            patientId: 501,
            delta: 10,
            amount: 100000,
            type: "earn",
            createdAt: 1_700_000_300,
          },
        ],
        // Sections outside the merge contract must be ignored, not crash.
        smsLog: [{ id: 1, phone: "0912", message: "x", status: "sent", createdAt: 1 }],
        laserClients: [{ id: 1, name: "laser x", createdAt: 1 }],
      },
    };

    const { report, ignoredSections } = await backupService.mergeRestore(payload);

    expect(report.patients).toMatchObject({ added: 1, skipped: 0 });
    expect(report.waitingList).toMatchObject({ added: 1, skipped: 0 });
    expect(report.surveys).toMatchObject({ added: 1, skipped: 0 });
    expect(report.loyaltyTransactions).toMatchObject({ added: 1, skipped: 0 });
    expect(ignoredSections.sort()).toEqual(["laserClients", "smsLog"]);

    // FK remap: the merged rows must point at the *new* local ids, not the
    // donor database's ids (501/601).
    const { db, waitingListTable, surveysTable, loyaltyTransactionsTable, patientsTable } =
      dbModule;
    const { eq } = await import("drizzle-orm");
    const patient = await db
      .select()
      .from(patientsTable)
      .where(eq(patientsTable.uuid, patientUuid))
      .get();
    expect(patient).toBeTruthy();

    const waiting = await db
      .select()
      .from(waitingListTable)
      .where(eq(waitingListTable.uuid, "waiting-uuid-1"))
      .get();
    expect(waiting?.patientId).toBe(patient!.id);

    const survey = await db
      .select()
      .from(surveysTable)
      .where(eq(surveysTable.uuid, "survey-uuid-1"))
      .get();
    expect(survey?.patientId).toBe(patient!.id);

    const loyalty = await db
      .select()
      .from(loyaltyTransactionsTable)
      .where(eq(loyaltyTransactionsTable.uuid, "loyalty-uuid-1"))
      .get();
    expect(loyalty?.patientId).toBe(patient!.id);

    // Re-merging the same file must dedupe by uuid, not duplicate rows.
    const second = await backupService.mergeRestore(payload);
    expect(second.report.waitingList).toMatchObject({ added: 0, skipped: 1 });
    expect(second.report.surveys).toMatchObject({ added: 0, skipped: 1 });
    expect(second.report.loyaltyTransactions).toMatchObject({ added: 0, skipped: 1 });
  });
});
