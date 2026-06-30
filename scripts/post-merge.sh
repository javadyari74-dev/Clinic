#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Rebuild the composite libraries so their emitted declarations (e.g. the
# codegen output in @workspace/api-client-react) stay in sync after a merge.
# dist/ is gitignored, so without this a merged codegen change leaves stale
# .d.ts files and breaks per-artifact typechecks.
pnpm run typecheck:libs
