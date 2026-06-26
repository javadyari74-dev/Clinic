---
name: Workflows after GitHub import
description: How to (re)start the dev stack in this repl when individual artifact workflows aren't registered.
---

# Workflows after GitHub import

After a GitHub import, the per-artifact workflows may not be registered in the run config. Symptoms:
- `restart_workflow("API Server")` (or any individual artifact name) fails with `RUN_COMMAND_NOT_FOUND` / "doesn't exist in config".
- The snapshot says "There are no workflows configured yet" even though the app is running.

**Why:** `.replit` has `runButton = "Project"` and no per-workflow `[[workflows.workflow]]` entries; the whole stack is launched by the single "Project" run button, not by named per-artifact workflows.

**How to apply:**
- To restart the dev stack, call `restart_workflow("Project")` — that name works. Individual artifact names do not.
- To re-register/refresh artifact services, copy each `artifacts/<slug>/.replit-artifact/artifact.toml` to a sibling temp file and call `verifyAndReplaceArtifactToml({tempFilePath, artifactTomlPath})` (artifacts skill). Doing this for all artifacts brings them back.
- Do NOT try to keep a dev server alive with `nohup`/`&` from a bash tool call — child processes are killed when the tool's shell session tears down. Use the workflow instead.

**Dev server note:** the api-server `dev` script is `build && start` with **no watch** — source edits are not hot-reloaded. After editing server code you must restart ("Project") to pick it up.
