---
name: Beauty Clinic App Stack
description: Architecture decisions and quirks for the مطب زیبایی دکتر یاری management system.
---

## Stack
- **SQLite** (migrated from PostgreSQL) via `@libsql/client` + Drizzle ORM (`sqliteTable`, NOT `pgTable`)
- DB file: `/home/runner/workspace/clinic.db` (absolute path, shared between drizzle-kit and api-server)
- Drizzle adapter: `drizzle-orm/libsql`, dialect: `turso` in drizzle.config.ts
- Express 5 backend at `artifacts/api-server`
- React + Vite frontend at `artifacts/beauty-clinic` (preview path `/`)
- Orval-generated React Query hooks from OpenAPI spec at `lib/api-spec/openapi.yaml`

## SQLite-specific decisions
- `@libsql/client` must be listed as direct dependency of **both** `lib/db` and `artifacts/api-server` (pnpm strict mode)
- `libsql`, `@libsql/client`, `@libsql/linux-x64-gnu`, `@libsql/linux-x64-musl` are all in esbuild external list in `artifacts/api-server/build.mjs`
- Schema uses `integer("id").primaryKey({ autoIncrement: true })` instead of `serial`
- Boolean fields: `integer("field", { mode: "boolean" })` instead of `boolean()`
- DB push command: `pnpm --filter @workspace/db run push`

**Why:** User requested migration from PostgreSQL to SQLite for simpler deployment without provisioned database.

## Auth System
- JWT-based, token stored in `localStorage` with key `clinic_auth_token`
- `setAuthTokenGetter` from `@workspace/api-client-react` (custom-fetch.ts) wires token to all orval-generated API calls — set in `main.tsx`
- Backend: `bcryptjs` (pure JS, bundleable) + `jsonwebtoken`; middleware in `api-server/src/lib/auth.ts`
- Seed admin: `api-server/src/lib/seed.ts` — runs after migrations, creates admin/admin123 if no admin exists
- `requireAuth` middleware applied via `router.use(requireAuth)` in routes/index.ts — **after** health + auth routes
- Wouter v3 has NO `<Redirect>` component — use `useLocation` + `useEffect` to redirect programmatically
- Permissions stored as JSON string in DB column; parsed on read, stringified on write
- Admin role bypasses all permission checks (hasPermission always returns true for admin)
- `ALL_PERMISSIONS` and `PERMISSION_LABELS` exported from `lib/db/src/schema/users.ts`

## Key Quirks

**Hook Signatures (Orval-generated):**
- Query hooks for path params take `id: number` directly: `useGetPatient(id)`, `useListPatientNotes(id)`, `useListPatientAppointments(id)` — NOT `{ id }`
- Revenue chart hook is `useGetRevenueChart()` not `useGetDashboardRevenueChart()`
- Mutation hooks: `useCreatePatient`, `useUpdatePatient`, `useDeletePatient`, etc. — all `use*` prefix

**SelectItem:** Never use `value=""` (empty string) in shadcn/ui Select — use "all" or similar sentinel value instead.

**Deposits (بیعانه) are payment records, not just a field:** When an appointment is created with `deposit > 0`, the appointments POST route ALSO inserts a `payments` row with `notes: "بیعانه"` linked to that appointment (alongside the `deposit` column on the appointment itself). Any "is this appointment already paid?" logic must EXCLUDE deposit payments (`notes === "بیعانه"`), otherwise reserved appointments that only paid a deposit get wrongly hidden from the cashier (صندوق) dropdown. There is no payment `type` column — deposit vs full payment is distinguished only by `notes`.

**Why:** Orval codegen produces hooks based on OpenAPI operationId naming, not URL path. Always grep the generated file for exact names before assuming naming conventions.

**How to apply:** When writing new frontend pages, always check `lib/api-client-react/src/generated/api.ts` for exact exported hook names before using.

## Per-unit / per-quantity service pricing
- A service can price by quantity (e.g. filler 1,990,000/cc × 5cc = 9,950,000). Model: existing money columns (`price`, `doctorFee`, `materialCost`, `otherCost`) always store the **raw** value; a sibling `*Mode` text column (`'total'` | `'per_unit'`) plus ONE shared `unitCount` (+ optional `unitLabel`) decide how to read it. Effective value = `mode === 'per_unit' ? raw * unitCount : raw`.
- This is **service-level**, not appointment-level — every appointment of that service uses the same effective amount. `unitCount`/`unitLabel` are shared across all four money fields; each field has its own independent mode toggle.

**Why:** Keeps the raw value editable and reversible (switching a field back to `total` ignores `unitCount`); avoids a per-appointment quantity which the user explicitly did not want.

**How to apply:** Anywhere you read these money fields for revenue/cost/profit (frontend `effective()` helper, backend `servicePrice` reads in appointments/patients, accounting CASE expressions) you MUST apply the mode×unitCount transform — never use the raw column directly for display or math. `unitCount` is `notNull default 1`; the four `*Mode` columns are `notNull default 'total'`.

### Appointment-level units override (payment/cashier flow)
- `appointments.units_used` (nullable int) records the ACTUAL quantity consumed, captured by the cashier at payment time. Effective per-appointment quantity = `coalesce(units_used, unit_count, 1)`.
- Payment POST: when `unitsUsed > 0` it's stored on the appointment (and the appointment is marked `completed`). For `total`-mode services no units are sent.
- Frontend payment dialog shows the "واحد مورد استفاده" input ONLY when `selectedAppt.priceMode === 'per_unit'`; `originalAmount` auto = `unitPrice × unitsUsed`. Appointment list `servicePrice` and accounting costs use `coalesce(units_used, unit_count, 1)` so they follow the recorded units, not the service default.

**Why:** `unitCount` is the service default; real consumption varies per visit (e.g. 3cc vs 5cc of filler), so the cashier overrides it per appointment without changing the service.

## DB migrations vs push (drift gotcha)
- Server applies FILE-BASED migrations at startup (`lib/db/migrations`, run via `migrate()`), AND the repo uses `drizzle-kit push` for schema changes. These have DIVERGED: every per-unit column (`price_mode`, `unit_count`, `unit_label`, the `*_mode` columns on services; `units_used` on appointments) was added by **push only** — none appear in any migration SQL (journal stops at 0000-0006, which predate the per-unit feature).
- Consequence: dev works (push applied to `clinic.db`), but a fresh DB built from migrations alone (e.g. first production deploy) will MISS these columns → runtime SQL failures for the entire per-unit feature.
- Performance indexes are ALSO push-only and not in any migration: `payments(paid_at)`, `payments(appointment_id, paid_at)`, `appointments(service_id)`, `appointments(patient_id)`. Without them the `/accounting/summary` correlated-EXISTS query times out at scale (~50k payments). A fresh migration-built DB will lack these → accounting timeouts. Include them in the deployment reconciliation migration.
- Do NOT just drop in a single migration file for one new column: push already added it to dev, so on next server restart the migrate runner runs `ALTER TABLE ... ADD COLUMN` on an existing column → "duplicate column" → startup crash. SQLite has no `ADD COLUMN IF NOT EXISTS`.

**Why:** the project settled on push for day-to-day schema changes; the migration journal was never kept in sync once the per-unit work began.

**How to apply:** keep using push for dev. Before any real deployment, do a dedicated reconciliation: generate ONE comprehensive migration matching the current schema, then either rebuild dev from migrations or mark that migration already-applied in dev's `__drizzle_migrations` so it isn't re-run. Never treat this as a per-column afterthought.

## Running one-off scripts / bulk data seeding
- There is NO `tsx`/`ts-node` and workspace packages (`@workspace/db`, `@libsql/client`) do NOT resolve as bare imports from the code_execution sandbox (repo root). To run a Node/TS script that uses the DB: drop a `.ts` in `artifacts/api-server/src/`, bundle it with esbuild (`platform:node, format:esm`, externalize `@libsql/client`/`libsql`/`*.node`), then `node dist/<file>.mjs`. `@workspace/db` resolves `clinic.db` relative to the bundle dir (`../../../clinic.db` from `artifacts/api-server/dist`), so it hits the same DB as the running server.
- **Timestamp units differ per table:** `appointments.scheduled_at` is **milliseconds**; `payments.paid_at`, `commissions.created_at`, `*.created_at` are **seconds**. Mixing them up silently puts data in the wrong era.
- The `/payments` and `/commissions` API routes force `paidAt`/`createdAt = now`, so backdated/time-spread bulk data must be inserted directly via Drizzle (`db.insert(table).values([...]).returning({id})`), not through the API.

**Why:** seeding 5000 backdated appointments/payments through the API is impossible (timestamps locked to now) and slow; direct Drizzle insert in a bundled script is the working path.

## List endpoints default-limit cap (صندوق "only 500" gotcha)
- The list routes (`/payments`, `/appointments`, `/patients`) historically defaulted to `limit = 500` when no `limit` query param was passed. The frontend calls these hooks with NO params, so pages that derive a count from `data.length` (e.g. صندوق "کل تراکنش‌ها") were silently capped at 500 even though the DB held far more rows. This looks like "only 500 records were saved" but is purely a display/transfer cap.
- `/payments` now returns ALL rows when `limit` is omitted (conditional `.limit/.offset` via `$dynamic()`), and still paginates when an explicit `limit` is given. `paymentsTable` has `payments_paid_at_idx` on `paid_at` to keep the full `ORDER BY paid_at DESC` cheap. `/appointments` and `/patients` were left at the 500 default (not requested).

**Why:** user reported the cashier page stuck at 500 transactions and wanted unlimited; the cap was a route default, not a write limit.

**How to apply:** if another page reports a suspiciously round count (500), check the route's default `limit` first before assuming a data bug. Applying the same "no limit ⇒ return all" pattern to appointments/patients would need its own index for large tables.

## OpenAPI ↔ generated-code drift (codegen gotcha)
- `lib/api-spec/openapi.yaml` is the source of truth; `pnpm --filter @workspace/api-spec run codegen` runs orval with `clean: true` which **wipes and fully regenerates** the output dirs from the yaml. If the yaml is missing a field that the *current* generated code happens to have, regenerating will silently DROP that field from the zod validators + react hooks.
- The yaml has drifted before (it lacked `doctorFee`/`materialCost`/`otherCost` on the Service schemas even though generated code had them).

**Why:** A stale yaml + a clean regen = silent data-loss in the API contract; the backend then fails to persist or validate fields it used to.

**How to apply:** Before running codegen, make the yaml a **superset** of what generated code already exposes (grep the generated `*.schemas.ts` / `types/` for any field absent from the yaml schema you're editing — and check sibling schemas like appointments, not just the one you changed). After codegen, run `git diff --name-only -- lib/api-zod lib/api-client-react` and confirm ONLY the files you intended changed. Also: any DB `notNull` column must be **non-nullable** in the `*Update` schema, or Drizzle `.set(parsed.data)` rejects `null`.

## Accounting reconciliation
- **Cost basis (both endpoints): per distinct SERVED appointment.** `serviceCosts` in `/api/accounting/summary` and the per-service costs in `/api/accounting/by-service` both count each appointment ONCE, gated on `EXISTS (a non-بیعانه payment in the period)`. per_unit costs = raw × `coalesce(units_used, unit_count, 1)` (summed over the served appointments); total costs = raw × served-appointment count. This FIXED a prior double-count where an appointment with deposit + final payment counted its cost twice.
- **Revenue basis: cash received (sum of ALL payment rows incl. deposits/بیعانه).** This is intentional cash-basis so the cashier's revenue equals cash in the drawer. It is NOT changed to per-served-appointment.
- **Known asymmetry (accepted, not a bug):** because revenue includes deposits but costs only land when a non-deposit payment exists, a deposit-only service (deposit paid, service not yet rendered) shows revenue with 0 cost / `completedCount=0`; and a deposit in one period + final payment in another splits revenue and cost across periods. This is correct cash-basis timing — do NOT "fix" it by excluding deposits from revenue (that breaks cash reconciliation) unless the user explicitly asks for accrual accounting.
- Both endpoints must draw from the **same set of services**: `/by-service` selects ALL services and relies on the final `revenue>0 || completedCount>0` filter to drop inactive ones; keep that in lockstep with `/summary`.

**Why:** the double-count came from aggregating cost per payment row; counting per served appointment is the correct accrual point for cost. Revenue stays cash-basis because the صندوق UI is about money actually collected.

**How to apply:** when changing the per-unit/cost formula, change BOTH the `/summary` SQL CASE and the `/by-service` cost helper in lockstep. The "served appointment" predicate (`EXISTS non-بیعانه payment in period`) must match in both. Leave the revenue SUM(payments) alone unless the user asks for accrual revenue.

## Payment receipt snapshots are the source of truth (صندوق)
- Each `payments` row carries denormalized snapshot columns (`patient_name`, `service_name`, `session_number`, `units_used`, `unit_label`, `discount_name`, `discount_amount`, `deposit_amount`). The cashier receipt is built FROM the payment row (`receiptFromPayment` in `payments.tsx`), NOT from a live join — so receipts open for any payment on any device and survive backup/restore. The deposit insert in appointments POST also writes these snapshots.
- Legacy/pre-upgrade payments with NULL snapshots are repaired at server startup by `backfillPaymentSnapshots()` (joins appointment→patient/service), alongside `backfillAppointmentCodes()`. Both run in `index.ts` after migrations+seed.

**Why:** snapshots make the cashbox fully self-contained and portable (phones, restored backups) without depending on the appointment/patient/service rows still existing.

**How to apply:** when adding a new receipt field, add the column to `paymentsTable`, the OpenAPI `Payment`+`PaymentInput`, regenerate codegen, write it at both payment POST and the deposit insert, and extend the backfill predicate/set for legacy rows.

## Backup / reset / restore
- `GET /backup/download`: version 2, exports 14 clinic tables (excludes all laser tables). `DELETE /reset` calls `wipeClinicData()` which deletes ALL clinic data INCLUDING services + staff, but keeps `users` (re-seeds admin) and the entire laser section. `POST /backup/restore`: wipes then chunked-inserts (CHUNK 100) in FK-parent→child order preserving IDs; users are upsert-by-username (not wiped) and `seedAdminUser()` re-runs so login always survives. `express.json` limit is 100mb for large backups.
- **Known gap (not fixed):** restore is NOT wrapped in a DB transaction — a mid-restore failure leaves data partially wiped. Wrapping it needs care because `seedAdminUser()` uses the outer `db`, and libsql interactive transactions hold the single file connection (nested `db` calls can lock).

**Why:** user wanted true cross-device persistence + full recoverability; reset previously skipped services/staff which left stale data after a "full" reset.

**How to apply:** never exclude laser tables from the keep-list when editing wipe/restore. Keep `BACKUP_VERSION` bumped whenever the table set changes. Round-trip test: login → `/backup/download` → `/reset` → `/backup/restore` and assert zero per-table count mismatches.
