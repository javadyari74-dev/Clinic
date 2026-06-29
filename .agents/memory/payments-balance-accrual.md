---
name: Payments balance vs accrual split
description: Which side (backend vs frontend) handles account-balance deduction vs referrer accrual at checkout.
---

# Payments: balance deduction vs referrer accrual

At checkout (`POST /payments`), referrer accrual is SPLIT BY referrer type — this split is the single most important invariant to keep in lockstep, or you double-credit / zero-credit:

- **staff / recipient / laser referrers → server-side, single point.** The payments route auto-computes `accrual = round(payment.amount * referrerRate / 100)` and inserts a `commissions` row (recipientType `staff` or `external`). The route GUARDS this with `referrerType !== "patient"`.
- **patient referrers → frontend/صندوق-orchestrated, NOT server-side.** When the paying patient's `referrerType === "patient"`, the payments UI auto-enables the تخصیص کمیسیون section (recipient type `patient`, recipient = referrerId, calc=percentage, value=referrerRate, all editable), and on submit posts a positive `referral_credit` account transaction to the referrer. The backend deliberately does NOT accrue this case. **Never re-add the patient branch to the server route while the UI does it — that double-credits.**
- **Account-balance DEDUCTION (using شارژ اکانت to pay) is client-orchestrated.** The backend does NOT subtract the wallet at checkout. The web payments page computes `applied = min(patientBalance, amountAfterDeposit)`, reduces `payment.amount` by it, then posts a separate signed-negative `deduct` account transaction.

**Why:** the user wants the patient-referrer commission to be reviewable/editable per-payment in the صندوق (operator can change the %), so it cannot be a silent server policy; staff/external accrual is fixed policy so it stays server-side and fires exactly once.

**How to apply:**
- The auto-fill effect that drives the patient-referrer case keyed on `selectedPatient` MUST have an else-branch that resets commission state (disable, type→staff, clear id/value) when the newly selected patient has no patient-referrer — otherwise switching appointments mid-dialog credits the PREVIOUS referrer.
- Patient-referrer credit is non-atomic (create payment, then create `referral_credit` txn). The shared `createAccountTxn` onError toast covers both deduct and credit failures; if it fails the referrer simply gets no credit (no server fallback), so the toast must stay so the operator fixes it manually.
- Because deduction is two non-atomic calls (create payment, then create deduct txn), a deduct failure is surfaced via a destructive toast so the operator can fix the balance manually. If stronger integrity is ever needed, add an atomic server endpoint that applies balance inside the payment insert.
- A zero cash `payment.amount` is VALID when wallet/deposit fully covers the due — never fall back to `originalAmount` in that case (guard the fallback on `balanceApplyEnabled || deposit > 0`).
