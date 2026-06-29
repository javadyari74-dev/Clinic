---
name: Migrations are hand-written — schema drift breaks fresh/production DBs
description: Why this clinic app's DB works in dev but a freshly-migrated DB (desktop/production) crashes on boot.
---

# Migrations are hand-written; dev uses push, so drift is silent

In this project the drizzle migrations in `lib/db/migrations/*.sql` are **hand-written**, NOT generated. The `meta/` folder has only `0000_snapshot.json`, and `drizzle-kit generate` fails (looks for per-migration snapshots that don't exist, malformed path error). The db package only exposes `push` / `push-force` scripts.

**Why this bites:** Dev databases are built with `drizzle-kit push`, which syncs the live DB straight from `lib/db/src/schema/*.ts`. So when someone adds a column to a schema file but forgets to also hand-write an `ALTER TABLE ... ADD COLUMN` migration, **dev keeps working** (push already added the column) while any DB built purely from migration files is missing it. That includes the desktop app (libsql migrator runs the `.sql` files against a fresh `clinic.db`) and any production deploy. Boot then crashes in `backfillPaymentSnapshots()` (runs at server startup in `artifacts/api-server/src/index.ts`) with `SQLITE_ERROR: no such column: ...`.

**How to apply:**
- After ANY change to `lib/db/src/schema/*.ts`, hand-write a matching migration in `lib/db/migrations/` AND add a `meta/_journal.json` entry (idx+1, tag = filename without `.sql`, version "6"). The runtime libsql migrator only reads `_journal.json` + the `.sql` files; it does NOT need per-migration snapshots, so manual entries are safe. Use `--> statement-breakpoint` between statements.
- To detect drift reliably, don't regex the SQL. Apply all migrations to a throwaway sqlite file, then compare `PRAGMA table_info(<table>)` against the columns parsed from the schema `.ts` files. (A fresh boot that reaches "Server listening" is the real proof — backfill exercises payments⋈appointments⋈patients⋈services.)
- `artifacts/api-server/build.mjs` copies `lib/db/migrations` → `dist/migrations`, and `desktop/scripts/assemble.mjs` copies that into the desktop bundle. Rebuild api-server (and re-assemble desktop after `rm -rf desktop/dist`) for a new migration to reach the packaged app.
