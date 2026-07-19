---
name: Frontend api types source
description: Which package the beauty-clinic frontend imports generated API hooks/types from, and an orval query-option gotcha.
---
The beauty-clinic frontend consumes the generated React Query hooks AND response
types from `@workspace/api-client-react` (e.g. `useListClientErrors`,
`getListClientErrorsQueryKey`, `type ClientErrorReport`). It does NOT depend on
`@workspace/api-zod` — that package is server-side only; importing it in the
frontend fails typecheck with "Cannot find module '@workspace/api-zod'".

**Why:** the two artifacts depend on different generated packages from the same
openapi spec; only api-client-react is listed in beauty-clinic's package.json.

**How to apply:** when adding a new endpoint surfaced in the UI, run codegen
(`pnpm --filter @workspace/api-spec run codegen`), then import the hook + types
from `@workspace/api-client-react`. When overriding the hook's `query` options
(e.g. `enabled`), you MUST also pass `queryKey: getXxxQueryKey(...)` or tsc
errors that `queryKey` is missing (orval's UseQueryOptions requires it).
