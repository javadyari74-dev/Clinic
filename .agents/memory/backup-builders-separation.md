---
name: Backup builders separation
description: Why manual-download backup and auto/merge backup use separate builders in the beauty-clinic app.
---

Manual download (`GET /api/backup/restore` path) and the internal auto/merge backup use **separate builders on purpose**.

- Manual download endpoint builds its payload inline (version 2, the original fixed set of tables). It must NOT be routed through the shared internal builder.
- The internal auto/merge builder (`buildBackupData` in `backup-service.ts`) may include extra tables (e.g. `patient_account_transactions`) that the legacy full-restore/reset does NOT wipe or restore.

**Why:** If a table is added to the manual-download payload but the legacy restore/wipe path doesn't handle it, a "full restore" silently becomes non-full — the download carries rows that restore ignores, leaving stale/orphan data. The requirement was to leave manual backup + normal restore logic/UI untouched, so the fix is to keep that table out of the manual payload and only carry it in auto/merge backups (which merge-restore does handle).

**How to apply:** Before adding any table to a backup builder, confirm every restore path that consumes it also handles it. If you can't touch the legacy restore/wipe path, do NOT add the table to the manual-download builder — add it only to the auto/merge builder.
