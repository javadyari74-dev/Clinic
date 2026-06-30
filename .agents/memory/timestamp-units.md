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
