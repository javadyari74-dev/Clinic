import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import { createClient } from "@libsql/client";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "./schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.SQLITE_DB_PATH ?? path.join(__dirname, "../../../clinic.db");

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
// migration's DML in this project is naturally idempotent (`INSERT OR IGNORE`,
// `UPDATE ... WHERE col IS NULL`), so replaying is safe. A fresh database runs
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
}

export * from "./schema";
