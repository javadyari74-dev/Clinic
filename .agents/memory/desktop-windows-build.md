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
