---
name: Melipayamak pattern (BaseServiceNumber) send
description: Rules for pattern/service SMS sends — endpoint, success detection, arg order contract
---

- Pattern sends use `POST rest.payamak-panel.com/api/SendSMS/BaseServiceNumber` with `{username, password, text: "arg1;arg2", to, bodyId(int)}`. No `from` needed (shared service line).
- Success: `RetStatus===1` and `Value` is a long positive recId. Small/negative `Value` = error: -1 wrong creds/no webservice access, -4 insufficient credit, -5 invalid/unapproved bodyId, -110 must use API Key instead of panel password, 0 unknown.
- Args are joined with `;` — semicolons/newlines must be sanitized out of each arg or the variable count shifts.
- **Why:** the arg order sent by the app is an implicit contract with the pattern text registered in the Melipayamak panel (`{0},{1},...`). Order lives in `PATTERN_VAR_ORDER` (appointment: name/date/time; payment: name/amount/service; commission: name/commission/rate/base; birthday: name).
- **How to apply:** never reorder or add args to a fire* pattern call without updating the UI guidance and telling the user to re-register panel patterns. Manual free-text sends always go via normal SendSMS (patterns can't carry free text); birthday manual send switches to the birthday pattern in pattern mode.
- Melipayamak blocks foreign IPs — real send tests only work from the user's PC in Iran, never from Replit.
