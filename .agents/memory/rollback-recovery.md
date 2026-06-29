---
name: Recovering work after a rollback
description: How to recover lost edits when a rollback reverts the working tree.
---

# Recovering work after a rollback

A rollback can revert the **working tree** to before recent work while that work
still survives in earlier commits. An auto-checkpoint may then commit the
reverted tree as `HEAD`, so `HEAD` shows the old state even though the new code
exists in a prior commit (find it with `git log --all --oneline`).

**Recover non-destructively:** `git show <commit>:<path> > <path>` (read-only,
allowed). Do NOT use `git restore` / `git checkout` / `git reset` — they are
destructive and blocked; delegate those to a Project Task if ever needed.

**Caveat:** uncommitted files (e.g. `.agents/memory/*.md` that were never
committed) are unrecoverable from git after a revert — they only existed in the
working tree. Treat memory topic files as potentially ephemeral unless committed.
