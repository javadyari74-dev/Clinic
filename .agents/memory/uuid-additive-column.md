---
name: UUID additive column pattern
description: How globally-unique uuid columns were added to core tables in the SQLite/drizzle clinic DB, and the nullability caveat.
---

Each core table carries a `uuid` (text, UUID v4) alongside the numeric autoincrement `id`. The `id` stays the PK/FK; uuid is purely additive.

- New rows: drizzle `$defaultFn(() => randomUUID())` (node:crypto) on the column; insert schemas `.omit({ uuid: true })` so clients can't set it.
- Existing rows: hand-written migration adds the column + a `CREATE UNIQUE INDEX IF NOT EXISTS <t>_uuid_unique`, then a JS backfill (`backfillUuids` in api-server backfill.ts) fills NULLs and returns per-table counts. Backfill also asserts zero NULLs remain afterward and throws (fail-loud, matching runMigrations philosophy).

**Why the column is nullable in the actual DB despite `.notNull()` in the drizzle schema:** SQLite cannot `ALTER TABLE ... ADD COLUMN` as NOT NULL on a populated table, so the migration adds it nullable. drizzle's `.notNull()` only affects generated types/fresh-DB DDL, not the hand-written migration. Uniqueness is enforced by the unique index; note SQLite treats NULLs as distinct, so the index does NOT enforce presence — the JS backfill + startup assertion are what guarantee no NULLs. Enforcing DB-level NOT NULL would require a per-table rebuild (risky with FKs), intentionally avoided.

**How to apply:** to add uuid to a new table, add the column with the same `$defaultFn`, omit it from the insert schema, append ALTER+unique-index to a migration, and add the table name to `UUID_TABLES` in backfill.ts.
