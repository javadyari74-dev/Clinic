---
name: GitHub push setup
description: Which repo/token to use when the user asks to push to GitHub, and the diverged-remote situation.
---

# GitHub push destination

- Push target: `https://github.com/javadyari74-dev/Clinic`, single branch `main`, using the `GH_PUSH_TOKEN` secret (`x-access-token:${GH_PUSH_TOKEN}@`). Never print the token; pipe push output through `sed "s|${GH_PUSH_TOKEN}|***|g"`.
- The git remote `origin` points to `drjavady-boop/Clinic` but the token account (`javadyari74-dev`) has NO write access there (403 verified) — do not push to origin.
- `git fetch` is blocked in the main agent sandbox (writes to .git objects); `git push` and `git ls-remote` work. Compare local vs remote via `ls-remote` + `merge-base --is-ancestor` + the GitHub compare API instead of fetching.
- Local `main` branch is stale; the platform's checkpoint history lives on the `replit-agent` branch — push THAT (`replit-agent:main`). Remote has diverged before (checkpoint dual-commits, consolidations, rollbacks), so pushes may need `--force`; local `replit-agent` is the source of truth.

# Rollback of 2026-07-13

Between sessions the user rolled the project back to roughly the 2026-07-02 state: loyalty club, surveys, waiting list, SMS scheduling, uuid columns, migrations 0011–0017 and several memory topic files were removed from the working tree. The newer work is NOT lost — it survives in git history (commit `c8b7ebf` "Add loyalty club (باشگاه مشتریان) feature end-to-end" is an ancestor of the current tip, also on the replit-agent branch) and can be recovered with `git show <commit>:<path> > <path>`.

**Recovery was completed 2026-07-15.** All deleted features were restored from commit `c8b7ebf`:
- Schema files: loyalty, surveys, waiting-list, sms-log, app-settings, backup-log, patient-account-transactions
- Migrations 0007, 0011–0017
- API routes: loyalty, surveys, waiting-list, SMS
- Frontend pages: loyalty.tsx, surveys.tsx, sms.tsx, reminders.tsx
- Core wiring: layout nav items, App.tsx routes, page-loaders, use-auth permissions
- API libs: sms.ts, birthdays.ts, backup-service.ts, loyalty.ts
- Tests: loyalty, surveys, waiting-list, SMS, survey-throttle
- Fixed: openapi.yaml restored + orval codegen re-run to regenerate api-zod/api-client-react types
- Fixed: `ApiError` exported from `api-client-react/src/index.ts`
- Fixed: `DB_PATH` exported from `lib/db/src/index.ts`
- Database was recreated fresh (previous was corrupt after rollback/restore churn)

Do not trust MEMORY.md index entries whose topic files are missing on disk — the rollback deleted some topic files.
