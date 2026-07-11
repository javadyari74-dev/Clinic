---
name: Atomic guarded insert for throttle/dedupe
description: How to make check-then-insert race-free on SQLite/libsql, and a drizzle db.get quirk on empty results.
---

# Atomic guarded insert (SQLite/libsql)

**Rule:** any "only one row per window/key" guard (e.g. per-patient SMS
throttle) must NOT be a SELECT-then-INSERT — two concurrent requests both pass
the check. Use a single statement:

```sql
INSERT INTO t (...) SELECT ... WHERE NOT EXISTS (SELECT 1 FROM t WHERE <guard>) RETURNING id
```

A single SQLite statement is atomic; the losing writer's NOT EXISTS sees the
winner's row. No transaction needed.

**Why:** code review rejected the survey-SMS throttle for exactly this race.

**How to apply:**
- Raw SQL bypasses drizzle `$defaultFn` defaults — supply `uuid`/`created_at`
  explicitly in the guarded INSERT.
- **drizzle libsql `db.get(sql\`...\`)` throws** ("Cannot convert undefined or
  null to object") when the query returns zero rows (the throttled case). Use
  `db.all<{...}>(sql\`...\`)` and take `rows[0]`.
- To test for real: mock `@workspace/db` with a real in-memory libsql client
  (`createClient({url: ":memory:"})`) + schema imported from
  `@workspace/db/schema` (importing the package root opens clinic.db as a side
  effect). See api-server test/survey-throttle.test.ts.
