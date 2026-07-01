---
name: Commission recipient profile attribution
description: The recipient referrals/profile endpoint must be driven by recorded commissions, not only current patient.referrer_id.
---

# Commission recipient profile must include orphaned recorded commissions

The `/commission-recipients/:id/referrals` profile must union (a) patients whose
CURRENT `referrer_id` = this recipient with (b) every patient that has a recorded
row in `commissions` for this recipient (recipientType "external"), joined via
`commissions.appointment_id -> appointments.patient_id`.

**Why:** commissions are accrued at payment time and are the source of truth for
earnings. If a patient's `referrer_id` is later changed/cleared, their recorded
commission still belongs to the original recipient. Listing referrals only by
current `referrer_id` orphans those commissions and the profile shows 0 earnings
even though real commission rows exist (observed: recipient earned ~91.8M from a
patient whose referrer was later nulled, but panel showed 0).

**How to apply:** gather commissionByPatient WITHOUT restricting to the current
referred ids; then fetch any patients present in commissions but missing from the
referred set and add them to the display list. Keep the recorded-amount-wins /
current-rate-estimate fallback per row.

## Commission source of truth (per-row amount)

The commission-recipient profile (`/commission-recipients/:id/referrals`) must read each referred
patient's earned commission and rate from the recorded rows in the `commissions` table
(`recipientType='external'`, `recipientId`), attributed to the patient via
`commissions.appointmentId -> appointments.patientId`. It must NOT recompute commission from the
patient's current `patientsTable.referrerRate`.

**Why:** Commission is accrued and frozen at payment time in `payments.ts` (amount + rate snapshot).
The patient's `referrerRate` is mutable and can be cleared or changed later. Recomputing from the
live rate showed پورسانت=0 / درصد="—" for patients who had genuinely earned commission (the reported
bug). `referrerRate` accrual only fires when rate > 0, so historical commissions are the only reliable
record of what was actually earned.

**How to apply:** For displayed rate on an aggregated per-patient row, use the rate of the LATEST
commission (by `createdAt`), not `max(rate)` — a patient can have commissions at different rates over
time. Precedence per patient: if recorded commission rows exist, they win (amount + latest rate).
ONLY when a patient has NO recorded commission at all, fall back to estimating `spent * currentRate/100`
using the live `patientsTable.referrerRate` (and show that rate). This covers payments made BEFORE the
referrer/rate was assigned (nothing accrued), which otherwise show پورسانت=0 / درصد="—" even though a
rate is set — the second reported bug. If neither recorded rows nor a live rate>0 exist, show 0 / "—".

**Why the two-way rule:** recorded rows are frozen truth for what was actually accrued; the live-rate
fallback is only an estimate for un-accrued historical spend. Never mix them (don't add estimate on top
of recorded) or you risk double-counting.
