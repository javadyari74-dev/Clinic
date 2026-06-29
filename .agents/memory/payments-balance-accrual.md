---
name: Payments balance vs accrual split
description: Which side (backend vs frontend) handles account-balance deduction vs referrer accrual at checkout.
---

# Payments: balance deduction vs referrer accrual

At checkout (`POST /payments`), responsibilities are split between server and client:

- **Referrer accrual is server-side and is the SINGLE accrual point.** The payments route auto-computes `accrual = round(payment.amount * referrerRate / 100)` from the paying patient's `referrerType/referrerId/referrerRate`. If `referrerType === "patient"` it credits the referrer's `accountBalance` (+ a `referral_credit` account transaction); otherwise it inserts a `commissions` row (recipientType `staff` or `external`). Do NOT add referrer accrual on the frontend — that would double-accrue.
- **Account-balance DEDUCTION (using شارژ اکانت to pay) is client-orchestrated.** The backend does NOT subtract the wallet at checkout. The web payments page computes `applied = min(patientBalance, amountAfterDeposit)`, reduces `payment.amount` by it, then posts a separate signed-negative `deduct` account transaction.

**Why:** the accrual is a deterministic policy that must fire exactly once, so it lives server-side; balance application is an operator choice toggled per-payment in the UI, so it stays client-side.

**How to apply:**
- The manual commission section in the payments UI is a SEPARATE operator-initiated feature, unrelated to the auto referrer accrual — they coexist without conflict.
- Because deduction is two non-atomic calls (create payment, then create deduct txn), a deduct failure is surfaced via a destructive toast so the operator can fix the balance manually. If stronger integrity is ever needed, add an atomic server endpoint that applies balance inside the payment insert.
- A zero cash `payment.amount` is VALID when wallet/deposit fully covers the due — never fall back to `originalAmount` in that case (guard the fallback on `balanceApplyEnabled || deposit > 0`).
