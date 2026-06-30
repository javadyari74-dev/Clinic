---
name: Desktop Windows (.exe) build
description: Why the Electron Windows build fails on Windows and the pre-build-on-Linux workaround.
---

# Desktop Windows (.exe) build

The repo can be packaged as a standalone Windows app via the `desktop/` folder (Electron + electron-builder, NSIS installer). The user-facing flow is in `desktop/README.md`.

## The trap: workspace pnpm config strips all non-Linux native binaries
`pnpm-workspace.yaml` has an `overrides` block that maps every non-linux-x64 platform binary of `esbuild` and `lightningcss` to `"-"` (removed), with the comment "replit uses linux-x64 only." Consequence: running the workspace build (`pnpm --filter ... run build`, i.e. vite + esbuild) **on Windows fails** — esbuild/vite have no win32 binary. Symptom the user hits: `ERR_PNPM_IGNORED_BUILDS` then `pnpm ... run build` exits code 1 inside `desktop/scripts/assemble.mjs`.

## Why pre-building on Linux is the fix
The build outputs are platform-independent:
- frontend `artifacts/beauty-clinic/dist/public` = static HTML/CSS/JS
- server `artifacts/api-server/dist/index.mjs` = plain JS bundle (esbuild externalizes `@libsql/client` and ALL its platform binaries incl. `@libsql/win32-x64-msvc`, so the native SQLite is resolved at runtime, not bundled)

Only Electron itself and the native `@libsql` binary must be Windows-specific. Those are handled by the **separate** `desktop/package.json` (plain `npm install`, NOT the pnpm workspace), so they sidestep the workspace overrides entirely.

**Approach:** build the JS bundles on Replit/Linux, ship `desktop/dist` pre-assembled. `assemble.mjs` was changed to skip the workspace build when `desktop/dist/server/index.mjs` + `desktop/dist/public/index.html` already exist. On Windows the user then only runs `cd desktop && npm install && npm run dist` — electron-builder packages the pre-built dist + Electron + win32 `@libsql`. No pnpm/esbuild on Windows.

**Why:** the workspace is Linux-only by design; forcing a Windows native build means either editing the security-sensitive overrides (lockfile churn) or pre-building the portable parts. Pre-building is cleaner and keeps the Replit setup untouched.

Default login after install: `admin` / `admin123`. DB stored in Windows `AppData` (survives reinstall).
