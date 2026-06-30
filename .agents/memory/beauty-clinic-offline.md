---
name: Beauty Clinic Offline Requirement
description: The clinic app must run 100% offline on Windows; how offline-readiness is preserved.
---

# Beauty Clinic must run 100% offline

The app is a standalone Windows desktop product (Electron in `desktop/`): it forks the
Express api-server and serves the React web build over `localhost`, with data in a local
SQLite file (`clinic.db`, stored under Electron `userData`). Migrations run automatically
on startup. No AI, analytics, telemetry, or external image/CDN calls at runtime.

**Rule:** never introduce a runtime dependency on the internet. In particular, fonts must
be bundled locally (we use `@fontsource-variable/vazirmatn`, imported in
`artifacts/beauty-clinic/src/main.tsx`) — do NOT load fonts from Google Fonts /
`fonts.googleapis.com` / `fonts.gstatic.com`.

**Why:** the clinic runs on a Windows PC that may have no internet. A CDN font link made
the UI fall back to a system font offline; localizing it restored correct Persian rendering.

**How to verify:** after a web build, `rg "googleapis|gstatic" artifacts/beauty-clinic/dist`
must return nothing, and `*.woff2` files must be present under `dist/`.
