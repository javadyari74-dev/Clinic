---
name: Migration journal drift (lost unit_label migration)
description: The schema declares many columns that no tip migration creates; a migration was lost during 0007 renumbering, crashing fresh-DB startup in backfill.
---

# Migration journal drift

The Drizzle schema declares columns that **no migration at the branch tips creates**:
`services.{unit_label,unit_count,price_mode,doctor_fee_mode,material_cost_mode,other_cost_mode}`,
`appointments.units_used`,
`payments.{patient_name,service_name,session_number,units_used,unit_label,discount_name,discount_amount,deposit_amount}`.

The original migration that added them (`0007_add_service_unit_label.sql`) was **dropped when `0007` was renumbered** to `0007_patient_tiers_balance_referrals`. The columns survived only because long-lived dev DBs were created via `drizzle-kit push` (full schema sync). A **freshly migrated DB lacks these columns** and the API server crashes at startup in `artifacts/api-server/src/lib/backfill.ts` (`backfillPaymentSnapshots` selects `services.unit_label` / `payments.patient_name`).

**Fix applied:** re-added the lost migration as `lib/db/migrations/0009_add_service_unit_label.sql` (same column set/types/defaults as the original) and registered idx 9 in `meta/_journal.json`.

**Why:** schema and journaled migrations drifted silently; `push`-created DBs masked it, so it only surfaces on a clean `migrate()` run.

**How to apply:** when startup fails with `no such column: <x>` in backfill, or after any migration renumber, diff schema columns against the union of migration `ALTER/CREATE` statements before trusting the journal. ALTER ADD COLUMN migrations are not idempotent — a DB that already has the columns (prior `push`) will fail re-applying.

## Drizzle libsql migrator: timestamp-only gate (not hashes)

`drizzle-orm/libsql/migrator` decides whether to run a migration by comparing each journal entry's `when` against the **single newest `created_at`** in `__drizzle_migrations` (`MAX(created_at)`). It does NOT check per-file hashes. So a migration runs iff its `when` is greater than the latest recorded timestamp. Consequences:
- A `drizzle-kit push`-created DB has the full schema but NO `__drizzle_migrations` rows → migrate() would replay everything.
- A DB migrated only through 0008 that also has the 0009 columns (push/sync) → migrate() replays 0009 → `duplicate column` crash.

**Fix in `lib/db/src/index.ts`:** `runMigrations()` calls `reconcileColumnDrift()` BEFORE `migrate()`. For each non-idempotent ADD-COLUMN migration (DRIFT_TARGETS, sentinel = `services.unit_label` for 0009): if the table exists AND the sentinel column already exists AND no record has `created_at >= when`, insert a `(hash, created_at=when)` row into `__drizzle_migrations` so drizzle skips it. Fresh DB (table absent) and genuinely-missing-columns DB are left untouched so migrate() runs normally.

**Why:** marking the newest migration applied is safe precisely because the sentinel column existing means the schema is already current (push syncs the whole schema). Since the gate is timestamp-only, recording the newest `when` also covers any older unrecorded entries.

**How to apply:** when adding a future non-idempotent ALTER ADD COLUMN migration, add a DRIFT_TARGETS entry (tag + a sentinel column it introduces). Verify with a fresh-DB run AND a drifted-DB run (build full schema, `DELETE FROM __drizzle_migrations WHERE created_at >= <when>`, confirm raw `migrate()` throws `duplicate column` but `runMigrations()` survives).
