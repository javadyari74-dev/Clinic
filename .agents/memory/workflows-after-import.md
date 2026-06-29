---
name: Workflows after import
description: How workflows behave/restart after importing this monorepo, and artifact re-registration.
---

# Workflows after import

- After an import, restart everything via the **"Project"** workflow entry, not
  the per-artifact workflow names (those may not be wired up immediately).
- Re-register an artifact's workflow/config with `verifyAndReplaceArtifactToml`
  (do not hand-edit `artifact.toml` / `.replit`).
- The `api-server` dev script has **no file watch** — it builds then starts, so
  code changes require a manual workflow restart to take effect.
