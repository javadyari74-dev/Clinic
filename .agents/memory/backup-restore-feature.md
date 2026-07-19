---
name: Backup/Restore feature
description: Rules for the clinic JSON backup/restore endpoints so no data group is silently lost.
---

# Backup / Restore (api-server `routes/backup.ts`)

The clinic has a full JSON backup (`GET /backup/download`) and restore (`POST /backup/restore`).
The restore WIPES then re-inserts. A `BACKUP_VERSION` integer tags the file format.

## Rule 1 — every table group must be in BOTH download and restore
The laser section (`laser_clients/services/appointments/payments/settings`) was originally
omitted from backup entirely, so a backup→restore cycle silently destroyed all laser data.
**Why:** the clinic relies heavily on the laser module; a "full backup" that drops it is a data-loss trap.
**How to apply:** when ANY new table is added to the schema, add it to the download selects AND the
restore inserts (parent→child order), and bump `BACKUP_VERSION`.

## Rule 2 — restore must be version/section-aware before wiping
Restore must NOT wipe a section that the incoming file doesn't contain, or restoring an OLD
backup erases newer data. Laser wipe is guarded by `hasLaserData` (presence of any `laser*` key).
`/reset` intentionally preserves laser+users, so it uses `wipeClinicData()` only — keep a SEPARATE
`wipeLaserData()` used solely by restore.
**Why:** legacy v2 files have no laser keys; unconditional `wipeLaserData()` would delete current laser data.

## Rule 3 — coerce date columns on restore
Drizzle `integer(..., {mode:"timestamp"})` columns require a `Date` on insert; JSON backups store
them as ISO strings, so a raw insert throws `value.getTime is not a function`. `restoreRows` runs
`coerceDateColumns()` (via `getTableColumns`, `dataType === "date"`) to rebuild `Date` objects.
**Caveat:** `new Date(number)` treats numbers as ms; our own backups are ISO strings so this is safe,
but hand-edited numeric (seconds) timestamps would misparse.

## Testing note
Endpoints require a Bearer JWT: POST `/api/auth/login` {admin/admin123} → use `Authorization: Bearer <token>`.
