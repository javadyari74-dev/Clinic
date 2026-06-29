---
name: Payment side-effect reversal on delete
description: What DELETE /payments/:id must atomically undo, and the commission↔payment linkage rule.
---

# Deleting a payment must reverse ALL its side-effects atomically

A payment is never just one row — at checkout it spawns: wallet/account transactions (`patient_account_transactions`, linked by `paymentId`: negative `deduct` and/or positive `referral_credit`), commission rows, and a discount `usageCount` increment. `DELETE /payments/:id` must reverse every one of these inside a single `db.transaction`, or the user is left with stranded commissions and wrong wallet balances.

The reversal:
- **Wallet txns:** for each txn with `paymentId === payment.id`, `accountBalance = accountBalance - txn.amount` (subtracting the SIGNED amount reverses both deduct[-] and credit[+]), then delete those txns.
- **Commissions:** delete by `paymentId === payment.id`.
- **Discount usage:** `usageCount = MAX(usage_count - 1, 0)` if `discountId`.

## Commissions link to a payment by `paymentId`, not `appointmentId`
`commissions` carries both `appointmentId` and `paymentId`. Deletion MUST key on `paymentId`.

**Why:** appointments can have MORE THAN ONE payment (no DB uniqueness on `payments.appointmentId`; seed data already has multi-payment appointments). Deleting commissions by `appointmentId` over-deletes other payments' commissions and unrelated manual commissions on the same appointment — a data-integrity bug.

**How to apply:**
- The DELETE handler claims the payment atomically with `DELETE ... RETURNING` at the TOP of the transaction (not a pre-`SELECT` outside it). If no row returns, throw a sentinel to roll back and return 404. **Why:** a pre-check `SELECT` outside the transaction lets two overlapping deletes both pass and double-apply the reversal (e.g. discount usage decremented twice). The atomic claim guarantees the reversal runs exactly once.
- Any side-effect that should be undone on payment delete must carry `paymentId`: commissions (column `payment_id`), and the patient-referrer `referral_credit` account transaction (the frontend صندوق passes `paymentId: payment.id` to `createPatientAccountTransaction`, and `PatientAccountTransactionInput` accepts it). A side-effect without a `paymentId` is orphaned and silently survives deletion.
- Adding a column to a schema needs a real migration file in `lib/db/migrations` + a `_journal.json` entry (this repo hand-writes migrations; `drizzle-kit generate` fails because intermediate snapshots are absent). `drizzle-kit push` only mutates the dev DB out-of-band and does NOT record the migration — if you push then later add the migration, boot fails with "duplicate column"; drop the pushed column so the migration becomes the single source of truth.
- Both server-side accrual (staff/external referrer in `POST /payments`) and the frontend manual تخصیص کمیسیون path set `paymentId` on the commission they create.
- Legacy commissions created before the `paymentId` column have `paymentId = null`. The DELETE handler has a backward-compat fallback: delete commissions by `appointmentId AND paymentId IS NULL` ONLY when this payment is the sole payment for that appointment (otherwise leave them, to avoid over-deleting another payment's legacy commission).
- The dev DB (`clinic.db`) does NOT re-seed clinic data on api-server restart — boot only runs `seedAdminUser` + backfills, so clinic data PERSISTS. e2e delete tests ARE destructive to seeded rows; prefer inserting your own test rows (a commission/txn carrying a `paymentId`) and deleting those. Seeded commissions all have `paymentId = null` (legacy fallback path).
