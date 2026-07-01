---
name: Commission source of truth
description: Where earned referral commission must be read from, and why recomputing from the live patient rate is wrong.
---

# Commission source of truth

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
