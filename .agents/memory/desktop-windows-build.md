---
name: Desktop Windows (.exe) build
description: Why the Electron Windows build fails on Windows and the pre-build-on-Linux workaround.
---

# Desktop Windows (.exe) build

The repo can be packaged as a standalone Windows app via the `desktop/` folder (Electron + electron-builder, NSIS installer). The user-facing flow is in `desktop/README.md`.

## The trap: workspace pnpm config strips all non-Linux native binaries
`pnpm-workspace.yaml` has an `overrides` block that maps every non-linux-x64 platform binary of `esbuild` and `lightningcss` to `"-"` (removed), with the comment "replit uses linux-x64 only." Consequence: running the workspace build (`pnpm --filter ... run build`, i.e. vite + esbuild) **on Windows fails** — esbuild/vite have no win32 binary. Symptom the user hits: `ERR_PNPM_IGNORED_BUILDS` then `pnpm ... run build` exits code 1 inside `desktop/scripts/assemble.mjs`.

**Why:** the Linux-only esbuild binary present in the workspace fails on Windows,
breaking any build that tries to bundle there.

## Runtime: the server is an external-deps ESM bundle

The api-server bundle externalizes the whole `@libsql/client` native stack, so at
runtime the packaged app must resolve it from a real `node_modules`. The desktop
forks `dist/server/index.mjs`; Node ESM walks up to the app-root `node_modules`
that electron-builder auto-includes from `desktop/package.json` deps (only
`@libsql/client` is needed — its closure pulls libsql, hrana, node-fetch, etc.).
A flat `node_modules` at app root resolves and starts cleanly (verified by running
the bundle directly). Do NOT hand-copy a partial @libsql subset — the closure has
native + non-@libsql transitive deps and partial copies fail.

**Set `npmRebuild: false`** in electron-builder.yml: libsql ships prebuilt N-API
binaries (ABI-stable), and rebuilding them against Electron headers can break the
native binding.

## Diagnose Windows-only startup crashes via the in-app log

Can't reproduce Windows crashes from Linux, so `main.cjs` self-diagnoses: it pipes
the forked server's stdout/stderr to `%APPDATA%/<userData>/server.log` and shows
the captured tail in the failure dialog. Ask the user for that file/screenshot.

**Avoid the dual-dialog race:** the server `exit` handler and the `waitForServer`
timeout are two failure paths. Without a shared `settled`/`serverReady` guard the
user sees BOTH "خطای سرور (کد 1)" and "Server did not become ready in time". Keep a
single settle: on crash-before-ready reject once (bootstrap shows one dialog) and
abort the readiness poll; only show the standalone server-crash dialog if it died
AFTER a successful start.
