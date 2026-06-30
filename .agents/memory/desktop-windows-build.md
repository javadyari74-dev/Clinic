---
name: Desktop Windows build
description: How to build the Electron Windows desktop app from this Linux workspace.
---

# Desktop Windows build

The pnpm workspace install strips non-Linux esbuild binaries, so a Windows
machine cannot run the JS bundling step from a fresh clone of this repo.

**Rule:** pre-build the JS bundles on Linux (here), commit/ship the prebuilt
output, and have the Windows side only run `electron-builder` to package the
installer — do not expect Windows to re-run esbuild/bundling.

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
