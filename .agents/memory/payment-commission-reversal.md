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
- Both server-side accrual (staff/external referrer in `POST /payments`) and the frontend manual تخصیص کمیسیون path set `paymentId` on the commission they create.
- Legacy commissions created before the `paymentId` column have `paymentId = null`. The DELETE handler has a backward-compat fallback: delete commissions by `appointmentId AND paymentId IS NULL` ONLY when this payment is the sole payment for that appointment (otherwise leave them, to avoid over-deleting another payment's legacy commission).
- The dev DB re-seeds on api-server restart, so e2e delete tests are non-destructive; seeded commissions all have `paymentId = null` (exercise the legacy fallback path), so cover the new-style path with a manually-inserted commission carrying a `paymentId`.
