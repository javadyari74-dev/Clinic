---
name: Commission dedupe constraint
description: Unique DB index prevents duplicate commissions per (payment, recipient); how the guard layers work.
---

The rule: at most ONE commission row per `(payment_id, recipient_type, recipient_id)` when `payment_id` is set.

**Why:** payments auto-accrual inserts a referrer commission on POST /payments; a manual POST /commissions for the same payment+recipient would double the commission (and duplicate the SMS). Recorded commissions are the frozen financial truth, so duplicates inflate totals.

**How to apply:**
- Enforced in three layers: (1) app-level pre-check in POST /commissions → 409 with Persian message; (2) partial unique index `commissions_payment_recipient_unique` (WHERE payment_id IS NOT NULL) — migration also dedupes keeping MIN(id) before creating the index so it never fails on legacy DBs; (3) insert catch maps UNIQUE-constraint errors to the same 409 (race safety).
- Commissions WITHOUT a paymentId (appointment-only/legacy) are NOT deduped — intentional.
- If a legitimate "split/adjustment" second commission for the same payment+recipient is ever needed, this rule must be consciously relaxed (drop or widen the index), not worked around.
