import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { createClient } from "@libsql/client";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "./schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.SQLITE_DB_PATH ?? path.join(__dirname, "../../../clinic.db");

const client = createClient({ url: `file:${DB_PATH}` });
export const db = drizzle(client, { schema });

// drizzle's libsql migrator decides whether to run a migration purely by
// comparing each migration's `when` timestamp against the single newest
// `created_at` recorded in `__drizzle_migrations` — it never checks per-file
// hashes, and it replays the *entire* migration file from the top. The
// journaled migrations are not idempotent: a bare `CREATE TABLE x` /
// `ALTER TABLE y ADD COLUMN z` crashes if the object already exists. This
// happens whenever the database drifted from the journal, e.g.:
//   - `drizzle-kit push` (our post-merge step) builds the schema directly but
//     does NOT populate `__drizzle_migrations`;
//   - a previous startup applied a migration only partially (added one column
//     of a multi-statement file) without recording it.
// On the next startup drizzle's migrate() then tries to replay objects that
// already exist and crashes ("table already exists" / "duplicate column name").
//
// To make startup robust we run migrations ourselves, statement by statement,
// skipping the benign "already exists" / "duplicate column" errors. Every
// migration's DML in this project must be naturally idempotent (`INSERT OR
// IGNORE`, `UPDATE ... WHERE col IS NULL`), so replaying is safe. Data fixes
// that are NOT idempotent go in ONE_TIME_DATA_FIXES below, never in a .sql file. A fresh database runs
// everything in order; a drifted database self-heals instead of crashing.

// Only the specific SQLite "object already present" errors are treated as
// benign during replay — narrow enough that a genuinely different error (bad
// SQL, constraint violation, missing table) still fails startup loudly.
const BENIGN_MIGRATION_ERRORS = [
  /duplicate column name/i,
  /table .+ already exists/i,
  /index .+ already exists/i,
  /trigger .+ already exists/i,
  /view .+ already exists/i,
];

function isBenignMigrationError(err: unknown): boolean {
  // drizzle wraps the driver error in a DrizzleQueryError whose own `message` is
  // only "Failed query: <sql>" — the real "duplicate column name" / "already
  // exists" text lives further down the `cause` chain (LibsqlError → SqliteError).
  // Collect every message in the chain before matching.
  const messages: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current != null && depth < 10; depth++) {
    if (current instanceof Error) {
      messages.push(current.message);
      current = (current as { cause?: unknown }).cause;
    } else {
      messages.push(String(current));
      break;
    }
  }
  const combined = messages.join(" | ");
  return BENIGN_MIGRATION_ERRORS.some((re) => re.test(combined));
}

async function recordMigration(when: number, hash: string): Promise<void> {
  // Only record once per migration `when`, so replaying on every startup does
  // not pile up duplicate rows in __drizzle_migrations.
  await db.run(
    sql`INSERT INTO __drizzle_migrations ("hash", "created_at")
        SELECT ${hash}, ${when}
        WHERE NOT EXISTS (SELECT 1 FROM __drizzle_migrations WHERE "created_at" = ${when})`,
  );
}

// Every migration in this project is idempotent in intent: the DDL is replayed
// through `isBenignMigrationError` (so "already exists"/"duplicate column" are
// skipped) and the only DML is `INSERT OR IGNORE` / `UPDATE ... WHERE col IS
// NULL`. That means it is always safe to replay *every* migration on startup.
//
// We deliberately do NOT gate on the newest recorded `created_at` (drizzle's
// strategy). Gating that way is what lets a drifted database start "successfully"
// while silently missing columns: if __drizzle_migrations claims a migration is
// applied but its `ALTER TABLE ... ADD COLUMN` never actually ran (partial
// apply, `drizzle-kit push`, a column manually/accidentally dropped), the column
// stays missing forever and every query that selects it fails with a 500 — which
// the UI surfaces as a generic "cannot reach server" error. Replaying all
// migrations every startup makes the schema self-heal to the journal regardless
// of how __drizzle_migrations drifted.
export async function runMigrations(migrationsFolder: string) {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) return;

  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as {
    entries: { tag: string; when: number }[];
  };
  const entries = [...journal.entries].sort((a, b) => a.when - b.when);

  await db.run(
    sql`CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
  );

  // Which migrations had already been recorded *before* this startup — used to
  // tell whether a one-time data fix already ran as part of an older migration.
  const recordedBefore = new Set(
    (await db.all<{ created_at: number }>(sql`SELECT "created_at" FROM __drizzle_migrations`)).map((r) =>
      Number(r.created_at),
    ),
  );

  for (const entry of entries) {
    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) {
      // A journaled migration with no SQL file means an incomplete/corrupted
      // bundle — fail loudly rather than starting with a partial schema.
      throw new Error(`Missing migration file for journal entry: ${entry.tag}`);
    }
    const migrationSql = fs.readFileSync(sqlPath, "utf-8");

    const statements = migrationSql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const statement of statements) {
      try {
        await db.run(sql.raw(statement));
      } catch (err) {
        // The object already exists (push-synced or partially-applied DB) —
        // safe to skip since every statement here is idempotent in intent.
        if (!isBenignMigrationError(err)) throw err;
      }
    }

    const hash = crypto.createHash("sha256").update(migrationSql).digest("hex");
    await recordMigration(entry.when, hash);
  }

  await runOneTimeDataFixes(recordedBefore);
}

// app_settings keys used as "already applied" markers for one-time data fixes.
// They are device-local bookkeeping and are excluded from backups.
export const DATA_FIX_KEY_PREFIX = "data_fix_";

// Data fixes that must run exactly ONCE per database. Because every migration
// file is replayed on every startup (see runMigrations), a non-idempotent data
// UPDATE must not live in a migration file — e.g. the loyalty "adjust" sign fix
// that used to be in 0023 was re-applied on every start and flipped legitimate
// new +X adjustments to −X. Each fix is guarded by an app_settings flag.
//
// `alreadyAppliedBy`: the journal `when` of the migration that used to contain
// this fix. If that migration was recorded before this startup, the fix has
// already run on this database, so we only set the flag (running it again
// would harm rows created since).
const ONE_TIME_DATA_FIXES: Array<{ key: string; alreadyAppliedBy?: number; statement: string }> = [
  {
    key: `${DATA_FIX_KEY_PREFIX}adjust_sign_done`,
    alreadyAppliedBy: 1791500000000, // 0023_add_payment_credit_amounts
    // Old code stored the loyalty side of a manual wallet/points adjustment with
    // the wrong sign: flip +X loyalty 'adjust' rows that were written together
    // (within 5s) with a −X 'loyalty_adjust' wallet row for the same patient.
    statement: `UPDATE \`loyalty_transactions\` SET \`amount\` = -\`amount\`
WHERE \`type\` = 'adjust' AND \`amount\` > 0 AND EXISTS (
  SELECT 1 FROM \`patient_account_transactions\` w
  WHERE w.\`patient_id\` = \`loyalty_transactions\`.\`patient_id\` AND w.\`type\` = 'loyalty_adjust'
    AND w.\`amount\` = -\`loyalty_transactions\`.\`amount\`
    AND ABS(w.\`created_at\` - \`loyalty_transactions\`.\`created_at\`) <= 5
)`,
  },
];

async function runOneTimeDataFixes(recordedBefore: Set<number>): Promise<void> {
  for (const fix of ONE_TIME_DATA_FIXES) {
    const done = await db.all<{ key: string }>(sql`SELECT "key" FROM app_settings WHERE "key" = ${fix.key}`);
    if (done.length > 0) continue;
    const ranViaOldMigration = fix.alreadyAppliedBy != null && recordedBefore.has(fix.alreadyAppliedBy);
    await db.transaction(async (tx) => {
      if (!ranViaOldMigration) await tx.run(sql.raw(fix.statement));
      await tx.run(
        sql`INSERT OR IGNORE INTO app_settings ("key", "value", "updated_at")
            VALUES (${fix.key}, ${new Date().toISOString()}, ${Math.floor(Date.now() / 1000)})`,
      );
    });
  }
}

export * from "./schema";
