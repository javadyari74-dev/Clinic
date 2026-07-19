---
name: Seeding against the live dev DB
description: Why a standalone seed script hits SQLITE_BUSY against clinic.db and how to make it wait.
---

A standalone seed/maintenance script that writes to `clinic.db` while the dev
`api-server` workflow is running fails with `SQLITE_BUSY: database is locked`.

**Why:** the running server keeps its own libsql connection open on the same
SQLite file. The default `busy_timeout` is 0, so any write contention errors out
immediately instead of waiting — even though the server is idle, bulk writes
trip transient locks.

**How to apply:** at the start of the script set `PRAGMA busy_timeout = 60000`
(and optionally `PRAGMA journal_mode = WAL`) on the seed's connection, so its
writes wait for the server's brief locks instead of failing. No need to stop the
server. There is no "stop workflow" tool anyway — only restart.

Run pattern for a TS seed that imports `@workspace/db`: bundle with esbuild
(externalize `@libsql/client`, `libsql`, `*.node`; add a `createRequire` banner),
then run the `.mjs` from the `artifacts/api-server` dir so the native client
resolves. Point it explicitly with `SQLITE_DB_PATH=/home/runner/workspace/clinic.db`.
