---
name: Payments balance vs accrual split
description: Which side (backend vs frontend) handles account-balance deduction vs referrer accrual at checkout.
---

# Payments: balance deduction vs referrer accrual

At checkout (`POST /payments`), responsibilities are split — referrer accrual is split BY referrer type, and account-balance deduction is now server-side. Keeping these in lockstep is the most important invariant, or you double-credit / zero-credit / overstate the wallet:

- **staff / recipient / laser referrers → server-side, single point.** The payments route auto-computes `accrual = round(payment.amount * referrerRate / 100)` and inserts a `commissions` row (recipientType `staff` or `external`). The route GUARDS this with `referrerType !== "patient"`.
- **patient referrers → frontend/صندوق-orchestrated, NOT server-side.** When the paying patient's `referrerType === "patient"`, the payments UI auto-enables the تخصیص کمیسیون section (recipient type `patient`, recipient = referrerId, calc=percentage, value=referrerRate, all editable), and on submit posts a positive `referral_credit` account transaction to the referrer via `createAccountTxn`. The backend deliberately does NOT accrue this case. **Never re-add the patient branch to the server route while the UI does it — that double-credits.**
- **Account-balance DEDUCTION (using شارژ اکانت to pay) is now SERVER-SIDE and atomic.** `POST /payments` accepts an input-only `applyAccountBalance` (positive integer); when > 0 it derives the patient from the appointment, checks sufficiency, then inserts the payment AND the signed-negative `deduct` txn + balance update inside one `db.transaction`. Insufficient balance returns 400 and records nothing. The frontend just passes `applyAccountBalance` and no longer orchestrates a separate deduct call.

**Why:** the user wants the patient-referrer commission to be reviewable/editable per-payment in the صندوق (operator can change the %), so it cannot be a silent server policy; staff/external accrual is fixed policy so it stays server-side and fires exactly once. Balance deduction used to be two non-atomic client calls (a deduct failure left the wallet overstated), so it was moved server-side into the payment-insert transaction for integrity.

**How to apply:**
- The auto-fill effect that drives the patient-referrer case keyed on `selectedPatient` MUST have an else-branch that resets commission state (disable, type→staff, clear id/value) when the newly selected patient has no patient-referrer — otherwise switching appointments mid-dialog credits the PREVIOUS referrer.
- Patient-referrer credit is still non-atomic (create payment, then create `referral_credit` txn via `createAccountTxn`). Its onError toast must stay so the operator fixes a failed credit manually (no server fallback for this case).
- `applyAccountBalance` is NOT a payments-table column — destructure it out of `parsed.data` before insert.
- Balance deduction requires an `appointmentId` (patient is derived from it); a balance apply without an appointment is rejected 400.
- The manual commission section in the payments UI is a SEPARATE operator-initiated feature, unrelated to the auto referrer accrual — they coexist without conflict.
- A zero cash `payment.amount` is VALID when wallet/deposit fully covers the due — never fall back to `originalAmount` in that case (guard the fallback on `balanceApplyEnabled || deposit > 0`).
