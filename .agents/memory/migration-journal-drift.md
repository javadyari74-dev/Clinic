---
name: Migration journal drift + idempotent applier
description: Schema columns drift from journaled migrations (push-synced/partial DBs); runMigrations now applies statements idempotently instead of using drizzle migrate().
---

# Migration journal drift

The Drizzle schema can declare columns that the journaled migrations also add via
`ALTER TABLE ADD COLUMN`. Two things make this fragile:

1. **Drizzle's libsql migrator gates by timestamp, not hashes.** It runs a journal
   entry iff its `when` is greater than `MAX(created_at)` in `__drizzle_migrations`,
   and it replays the *entire* migration file from the top. The migrations are not
   idempotent, so replaying `ALTER ADD COLUMN`/`CREATE TABLE` on an object that
   already exists throws (`duplicate column name` / `... already exists`).

2. **DBs drift from the journal.** A `drizzle-kit push`-created DB has the full
   schema but no `__drizzle_migrations` rows. A DB whose last startup applied a
   multi-statement migration only partially (e.g. added `services.unit_count` but
   never recorded the migration) has the column without the journal row. On the next
   startup drizzle replays that migration and crashes.

**Real incident:** the packaged Windows desktop app crashed at startup with
`SQLITE_ERROR: duplicate column name: unit_count` (migration 0009 adds
`unit_count` + `unit_label` on services + `unit_label` on payments). The user's
`clinic.db` had `unit_count` but 0009 was unrecorded → drizzle `migrate()` replayed
0009 → crash.

## Fix: idempotent applier replaces drizzle migrate()

`runMigrations()` in `lib/db/src/index.ts` no longer calls drizzle's `migrate()`.
It iterates journal entries with `when > MAX(created_at)`, splits each file on
`--> statement-breakpoint`, runs each statement, and **swallows only the specific
SQLite "object already present" errors** (duplicate column / table|index|trigger|view
already exists), then records the migration. Fresh DB applies everything in order;
push-synced and partially-applied DBs self-heal.

**Why this is safe here:** every migration is DDL plus naturally-idempotent DML
(`INSERT OR IGNORE`, `UPDATE ... WHERE col IS NULL`). A non-benign error (bad SQL,
constraint violation, missing table) still fails startup loudly. A journal entry
with a missing `.sql` file now throws instead of being skipped.

**Gotcha that cost time:** the benign-error check must walk the **`.cause` chain**.
Drizzle wraps the driver error in `DrizzleQueryError` whose `message` is only
`"Failed query: <sql>"`; the actual `duplicate column name` text lives in
`cause` → LibsqlError → SqliteError. Matching on `err.message` alone misses it,
and a re-thrown error keeps its *original* stack, so it looks like the throw came
straight from `db.run` even though your catch ran.

**How to apply / verify:** test a fresh DB (all migrations apply, health 200) AND a
drifted DB (build full schema, `DELETE FROM __drizzle_migrations WHERE created_at >=
<when>` for the last entries, confirm startup self-heals and the column appears
exactly once). When the server is bundled (desktop/api-server), `@workspace/db`
resolves to `src/index.ts` (no stale dist), so editing source + re-running the
bundle assembler is enough — no separate db build step.
