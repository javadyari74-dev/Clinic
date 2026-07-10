---
name: SMS fire-and-forget contract
description: Melipayamak SMS must never block or fail core operations; how the send path is isolated and logged.
---

The rule: SMS is strictly fire-and-forget. No SMS-related code (including DB lookups that only feed an SMS, e.g. recipient name/phone) may run awaited in an HTTP request path. Wrap the whole prep+send in `void (async () => { try … catch { logger.warn } })()`.

**Why:** the app must work 100% offline (Electron desktop); an SMS panel outage or a lookup error must never fail an appointment/payment/commission write. An earlier review failed the task because recipient lookups were awaited in-band.

**How to apply:**
- `fire{Appointment,Payment,Commission}Sms` in the SMS lib are void-async and internally caught; pass `phone ?? ""` through so invalid/missing numbers still produce a `failed` sms_log row ("شماره موبایل معتبر نیست") — silent skips are only for intentional policy (feature toggled off, zero amount).
- Melipayamak REST success = `RetStatus === 1` AND `String(Value).length > 10`; credit check ok = `RetStatus === 1`.
- Credentials/templates live in `app_settings` (DB, not env); the panel password is never returned to the client (only `hasPassword`), and an empty password on PUT means "keep existing".
