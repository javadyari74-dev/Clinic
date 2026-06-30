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
  await db.run(
    sql`INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (${hash}, ${when})`,
  );
}

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

  const maxRows = await db.all<{ maxWhen: number | null }>(
    sql`SELECT MAX(created_at) AS maxWhen FROM __drizzle_migrations`,
  );
  let appliedMax = maxRows[0]?.maxWhen != null ? Number(maxRows[0].maxWhen) : null;

  for (const entry of entries) {
    // drizzle treats migrations with `when` <= the newest recorded as applied.
    if (appliedMax !== null && entry.when <= appliedMax) continue;

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
    appliedMax = entry.when;
  }
}

export * from "./schema";
