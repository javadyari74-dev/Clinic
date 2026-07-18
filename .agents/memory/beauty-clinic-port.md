---
name: Beauty-clinic port (Doctor Yari)
description: Durable lessons from porting the user's existing mid-development clinic management monorepo into Replit.
---

# Porting the beauty-clinic ("مطب زیبایی دکتر یاری") app

The user uploaded an existing app to be **ported (not rebuilt)** so they can keep editing it. The uploaded snapshot was captured **mid-feature**: many features had frontend written but backend/schema missing, or vice-versa, plus leftover dead imports.

## Rules learned (apply to any similar port)

- **Grep every import against actual exports before declaring done.** Vite/esbuild dev build does NOT typecheck, so missing imports, undefined identifiers, and non-existent generated hooks pass silently at dev time and only crash the affected page at runtime. Run `pnpm run typecheck` (or per-artifact typecheck) to surface them. Half-finished features show up as: imports of modules that don't exist, generated hooks that were never generated, and identifiers used but never declared.
- **Distinguish "finish the feature" vs "remove dead leftover."** Where intent is clear and the counterpart is plumbed (e.g. patient wallet account-transactions, commission-recipient referrals), complete it faithfully. Where an import is unused in the file body and no system exists for it (e.g. a tier system), just remove the dead import — do not invent the system.
- **Some half-wired UI has no backend contract at all.** Example: a wallet "apply balance to this payment" toggle referenced state that had no UI and no server deduction path — declared minimal inert state so it compiles rather than inventing a broken feature.

**Why:** these traps cost multiple debugging passes; the dev server ran fine while individual pages would have crashed.

## Gotchas

- In `openapi.yaml`, always `$ref` request bodies to a named component schema. An **inline** body makes orval emit a zod const *and* a TS type with the same operation-derived name in two files, and the `export *` barrel in `lib/api-zod` fails with TS2308 "already exported a member".
- The user's GitHub repo (`javadyari74-dev/Clinic`) is a **parallel fork** of this app with its own diverging migration numbering — never blind-sync files from it. Compare at the **feature level** and port only genuine deltas into this repo's architecture; its schema/migrations must not overwrite ours.
- Changing the JWT signing secret **invalidates all existing tokens**; browsers with a stored `clinic_auth_token` then get blanket 401s (UI shows generic load errors, not a logout). When testing after an auth change, clear localStorage and re-login before trusting failures.
- **Windows delivery = prebuilt-zip flow** (`desktop/` Electron dir): build frontend (`BASE_PATH=/`) + api-server on Linux, run `desktop/scripts/assemble.mjs`, zip `desktop/` **excluding node_modules, release, and package-lock.json** — an `npm install` run inside Replit writes a lockfile whose `resolved` URLs point at Replit's internal package mirror, which breaks `npm install` on the user's Windows machine. User builds the installer on Windows with `npm install && npm run dist:prebuilt`.
- After codegen, a **stale Vite optimizer cache** (`artifacts/<app>/node_modules/.vite`) can keep reporting "No matching export" / "Failed to run dependency scan" for newly generated symbols. Clearing `.vite` and restarting the workflow fixes it. Verify against a **fresh** log — restarts create a new log file; an old log path can mislead you into thinking the error persists.
