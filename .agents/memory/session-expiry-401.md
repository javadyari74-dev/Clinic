---
name: Session expiry 401 handling
description: Convention for handling expired-JWT 401s in the beauty-clinic frontend
---

The rule: every API call path must converge on `notifySessionExpired()` (in `use-auth.tsx`) when it sees a 401 — it removes the token, dispatches the `clinic:session-expired` window event (AuthProvider clears state → redirect to login), and shows the Persian toast, deduped by a token-existence guard.

**Why:** JWTs expire after 7 days; before this convention, an expired token left in localStorage made every request 401 and the dashboard showed a misleading generic "server connection error" instead of returning the user to login.

**How to apply:**
- Generated client (react-query) 401s are caught globally in App.tsx via QueryCache/MutationCache `onError` (checks `ApiError.status === 401`).
- Any manual `fetch` hitting a protected route must be wrapped with `guardSession(res)` from `use-auth.tsx`.
- Do NOT wrap the login fetch (401 there means wrong password) or unauthenticated endpoints (e.g. client-errors reporting).
- `parseToken` rejects tokens whose `exp` has passed, so app startup with a dead token lands on login immediately.
