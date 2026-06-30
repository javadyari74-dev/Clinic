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

**How to push (plain fast-forward, no force):**
`git push "https://x-access-token:${GH_PUSH_TOKEN}@github.com/javadyari74-dev/Clinic.git" HEAD:refs/heads/main`
Local `replit-agent` history is a linear descendant of what's on remote `main`, so plain
pushes fast-forward. Never force-push (and main-agent can't run destructive git anyway).

**Timing caveat:** the main agent cannot `git commit`. New working-tree edits only get
committed by the Replit auto-checkpoint at end of turn, so they reach GitHub on the *next*
push (e.g. the next time the user requests a change). Push after the checkpoint exists.
