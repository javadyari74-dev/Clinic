---
name: GitHub Push Setup
description: How to push this project to the user's canonical GitHub repo.
---

# Pushing to the user's GitHub repo

Canonical repo: `https://github.com/javadyari74-dev/Clinic`, with a **single `main` branch**
(the user explicitly wants no side branches). All future changes go only to that `main`.

**Why it's not automatic:** the GitHub account connected to this Repl (`gagoo74`) has only
pull (read) access to that repo, so the Replit Git pane / checkpoint sync cannot push there.
Pushing is only possible with a Personal Access Token from the `javadyari74-dev` account,
provided as the env secret `GH_PUSH_TOKEN` (do not print its value).

**History rewrite (July 11, 2026):** remote `main` was rewritten with git-filter-repo to
purge `clinic.db`, `clinic.db-wal`, `clinic.db-shm` blobs (patient data / SMS credentials).
Local platform-managed history was NOT rewritten, so it is **no longer a descendant of
remote main** and still contains those blobs. **Never push local history directly again** —
a plain push will be rejected, and forcing it would re-expose the purged data.

**How to push now (snapshot method):** in /tmp, clone remote `main`, overlay the current
working tree via `git archive | tar` (excluding `.git`, `*.db*`, `.local`, `node_modules`),
commit the snapshot on top of remote main, and plain fast-forward push:
`git push "https://x-access-token:${GH_PUSH_TOKEN}@github.com/javadyari74-dev/Clinic.git" HEAD:refs/heads/main`
Never force-push. Always verify no `*.db*` files are staged before committing.

**Timing caveat:** the main agent cannot `git commit`. New working-tree edits only get
committed by the Replit auto-checkpoint at end of turn, so they reach GitHub on the *next*
push (e.g. the next time the user requests a change). Push after the checkpoint exists.
