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
