---
name: SQLite ilike patient-search bug
description: Patient list search 500s because it uses Postgres ilike on a SQLite DB.
---

# Patient search uses `ilike` (Postgres) on SQLite → 500

`GET /api/patients?q=...` (in `api-server/src/routes/patients.ts`) builds its WHERE with drizzle `ilike(name|phone|fileNumber, %q%)`. The app migrated PostgreSQL → SQLite (libsql), which has NO `ILIKE` operator, so any non-empty `q` makes the query throw and the route returns HTTP 500. The unfiltered list (no `q`) works fine.

**Why it matters:** every patient-list search box use 500s for the real user, and any e2e test that searches patients gets blocked. Reproduce: `curl "$API/api/patients?q=foo" -H "Authorization: Bearer <token>"`.

**How to fix when in scope:** swap `ilike` → `like` from `drizzle-orm` (SQLite `LIKE` is already case-insensitive for ASCII). Grep for other `ilike` imports/usages before/after migration — at the time this was found, `patients.ts` was the only file using it.
