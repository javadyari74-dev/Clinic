import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
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
// hashes. Several "ADD COLUMN" migrations (notably 0009) are therefore NOT
// idempotent: if a long-lived / production database already contains those
// columns (e.g. it was created or synced via `drizzle-kit push`, which does
// not populate `__drizzle_migrations`), drizzle would still try to re-apply
// the migration and crash with "duplicate column name" at startup.
//
// To make startup robust we reconcile that drift BEFORE running migrate():
// when the schema already contains the columns a column-adding migration
// would create, we record that migration in `__drizzle_migrations` so drizzle
// skips it. A fresh database is untouched (the tables don't exist yet) and a
// database that is genuinely missing the columns still gets them via migrate().

type DriftTarget = {
  // Migration tag whose ADD COLUMN statements are not idempotent.
  tag: string;
  // A sentinel (table, column) that the migration introduces. If this column
  // already exists, every column the migration adds is assumed present.
  table: string;
  column: string;
};

// Only column-adding migrations that would throw on re-application need guards.
const DRIFT_TARGETS: DriftTarget[] = [
  { tag: "0009_add_service_unit_label", table: "services", column: "unit_label" },
];

async function tableExists(name: string): Promise<boolean> {
  const rows = await db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${name}`,
  );
  return rows.length > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  // PRAGMA does not accept bound parameters; table names here are fixed
  // constants from DRIFT_TARGETS, so there is no untrusted input.
  const rows = await db.all<{ name: string }>(sql.raw(`PRAGMA table_info(${table})`));
  return rows.some((row) => row.name === column);
}

async function markMigrationApplied(migrationsFolder: string, tag: string): Promise<void> {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as {
    entries: { tag: string; when: number }[];
  };
  const entry = journal.entries.find((e) => e.tag === tag);
  if (!entry) return;

  const when = entry.when;
  const migrationSql = fs.readFileSync(path.join(migrationsFolder, `${tag}.sql`), "utf-8");
  const hash = crypto.createHash("sha256").update(migrationSql).digest("hex");

  // Mirror the table definition drizzle's migrator uses.
  await db.run(
    sql`CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
  );

  // If a migration with an equal-or-newer timestamp is already recorded,
  // drizzle would skip this one anyway — nothing to do.
  const alreadyRecorded = await db.all<{ created_at: number }>(
    sql`SELECT created_at FROM __drizzle_migrations WHERE created_at >= ${when} LIMIT 1`,
  );
  if (alreadyRecorded.length > 0) return;

  await db.run(
    sql`INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (${hash}, ${when})`,
  );
}

async function reconcileColumnDrift(migrationsFolder: string): Promise<void> {
  for (const target of DRIFT_TARGETS) {
    // Fresh database: let migrate() create everything from scratch.
    if (!(await tableExists(target.table))) continue;
    // Columns are genuinely missing: let migrate() add them via the migration.
    if (!(await columnExists(target.table, target.column))) continue;
    // Columns already present: record the migration so drizzle skips it.
    await markMigrationApplied(migrationsFolder, target.tag);
  }
}

export async function runMigrations(migrationsFolder: string) {
  await reconcileColumnDrift(migrationsFolder);
  await migrate(db, { migrationsFolder });
}

export * from "./schema";
