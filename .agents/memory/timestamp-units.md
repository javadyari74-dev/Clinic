---
name: Timestamp Units Quirk
description: Mixed ms/seconds timestamps across the DB and how formatShamsiDate handles them.
---

## Rule
`formatShamsiDate(ts)` auto-detects: if `ts > 1e11`, treat as milliseconds; otherwise multiply by 1000 (seconds → ms).

**Why:** Seeded appointments (`scheduled_at`) store milliseconds; payments (`paid_at`, `created_at`) store seconds. Passing an ms value like `1735000000000` and multiplying by 1000 again produces year ~58000, which causes a stack overflow in `Intl.DateTimeFormat` with the Persian calendar.

**How to apply:** Any new column storing a timestamp must decide: ms or seconds. Match existing convention per-table:
- `appointments.scheduled_at` → milliseconds
- `payments.paid_at`, `*.created_at` → seconds
When creating new timestamps in server routes, use `Date.now()` (ms) for appointment timestamps, `Math.floor(Date.now() / 1000)` (seconds) for payment/activity timestamps.

**API server note:** `CreateAppointmentBody` (zod schema in `lib/api-zod`) does NOT include `deposit` — deposit field exists in the appointments table but is stripped by zod on create. To enable deposit via UI, add `deposit` to the openapi spec and regenerate.

## Dashboard date-units bug (known, unfixed)
`dashboard.tsx` helpers `isSameShamsiDay` and the calendar `getShamsiParts(new Date(ts * 1000))` always multiply by 1000 — i.e. they assume the timestamp is in SECONDS. This is WRONG for `appointments.scheduled_at`, which is milliseconds when created via the UI form (`dateTimeToMs` → `.getTime()`) or via the API (`Date.now()`). Result: the dashboard "نوبت‌های امروز" (today) card and the calendar appointment dots silently DROP all ms-stored appointments (year resolves to ~58000), so UI/API-created appointments never show as "today". Seeded appointments stored in seconds DO show — so the data is mixed and the bug is intermittent-looking.

**Why this matters:** any verification that an appointment (or its tier badge) appears on the dashboard will fail for normally-created appointments even though the feature itself is fine elsewhere.

**How to fix when in scope:** route every dashboard timestamp through a `toMs(ts)=ts>1e11?ts:ts*1000` auto-detect (the pattern already used by `appointments.tsx` `toMs()` and by `formatShamsiDate`) instead of the bare `* 1000`.
