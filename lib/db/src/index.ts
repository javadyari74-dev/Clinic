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
// hashes. The journaled migrations are also not idempotent: a bare
// `CREATE TABLE x` / `ALTER TABLE y ADD COLUMN z` crashes if the object
// already exists. This happens whenever the database was created or synced via
// `drizzle-kit push` (our post-merge step runs `pnpm --filter db push`), which
// builds the full schema directly but does NOT populate `__drizzle_migrations`.
// On the next startup `migrate()` then tries to replay migrations for objects
// that already exist and crashes ("table already exists" / "duplicate column").
//
// To make startup robust we reconcile that drift BEFORE running migrate():
// for every migration drizzle is about to run, if every object it would create
// (tables / columns / indexes) already exists, we record it in
// `__drizzle_migrations` so drizzle skips it. A fresh database is untouched
// (its objects don't exist yet, so nothing is skipped and migrate() builds
// everything), and a database genuinely missing an object still gets it.

async function tableExists(name: string): Promise<boolean> {
  const rows = await db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${name}`,
  );
  return rows.length > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  if (!(await tableExists(table))) return false;
  // PRAGMA does not accept bound parameters. `table` here originates only from
  // our own committed migration SQL (not user input), and we further restrict
  // it to a safe identifier to avoid any injection surface.
  if (!/^[A-Za-z0-9_]+$/.test(table)) return false;
  const rows = await db.all<{ name: string }>(sql.raw(`PRAGMA table_info(${table})`));
  return rows.some((row) => row.name === column);
}

async function indexExists(name: string): Promise<boolean> {
  const rows = await db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ${name}`,
  );
  return rows.length > 0;
}

type MigrationObject =
  | { kind: "table"; name: string }
  | { kind: "column"; table: string; column: string }
  | { kind: "index"; name: string }
  | { kind: "unknown" };

// Parse the objects a drizzle-generated migration creates. Drizzle separates
// statements with `--> statement-breakpoint`. We only need to recognise the
// object-creating statements; anything unrecognised marks the migration as
// not auto-skippable so it is always run by migrate().
function parseMigrationObjects(migrationSql: string): MigrationObject[] {
  const unquote = (s: string) => s.replace(/^[`"']|[`"']$/g, "");
  return migrationSql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean)
    .map<MigrationObject>((stmt) => {
      const table = stmt.match(
        /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"'\w]+)/i,
      );
      if (table) return { kind: "table", name: unquote(table[1]) };

      const column = stmt.match(
        /^ALTER\s+TABLE\s+([`"'\w]+)\s+ADD\s+(?:COLUMN\s+)?([`"'\w]+)/i,
      );
      if (column)
        return { kind: "column", table: unquote(column[1]), column: unquote(column[2]) };

      const index = stmt.match(
        /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"'\w]+)/i,
      );
      if (index) return { kind: "index", name: unquote(index[1]) };

      return { kind: "unknown" };
    });
}

async function migrationFullyApplied(objects: MigrationObject[]): Promise<boolean> {
  if (objects.length === 0) return false;
  for (const obj of objects) {
    if (obj.kind === "unknown") return false;
    if (obj.kind === "table" && !(await tableExists(obj.name))) return false;
    if (obj.kind === "column" && !(await columnExists(obj.table, obj.column))) return false;
    if (obj.kind === "index" && !(await indexExists(obj.name))) return false;
  }
  return true;
}

async function recordMigration(tag: string, when: number, hash: string): Promise<void> {
  await db.run(
    sql`INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (${hash}, ${when})`,
  );
}

// Mark every still-pending migration whose objects already exist as applied so
// drizzle's migrate() skips it instead of crashing on a push-synced database.
async function reconcileMigrationDrift(migrationsFolder: string): Promise<void> {
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
    // drizzle treats migrations with when <= newest recorded as already applied.
    if (appliedMax !== null && entry.when <= appliedMax) continue;

    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) continue;
    const migrationSql = fs.readFileSync(sqlPath, "utf-8");

    if (!(await migrationFullyApplied(parseMigrationObjects(migrationSql)))) {
      // Objects are (at least partly) missing — let migrate() run this and any
      // later migration normally; do not skip ahead.
      break;
    }

    const hash = crypto.createHash("sha256").update(migrationSql).digest("hex");
    await recordMigration(entry.tag, entry.when, hash);
    appliedMax = entry.when;
  }
}

export async function runMigrations(migrationsFolder: string) {
  await reconcileMigrationDrift(migrationsFolder);
  await migrate(db, { migrationsFolder });
}

export * from "./schema";
