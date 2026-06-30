---
name: Codegen + TypeScript project references
description: Why api-server can see stale generated types after an openapi/codegen change.
---

# api-zod is consumed via TS project references — rebuild the composite after codegen

`artifacts/api-server/tsconfig.json` references `lib/api-zod` as a TypeScript **project reference** (`references: [{ path: ../../lib/api-zod }]`). With references, tsc resolves the dependency to its EMITTED declaration files (`lib/api-zod/dist/generated/*.d.ts`), not to `src/`.

**Why this bites:** running `pnpm --filter @workspace/api-spec run codegen` regenerates `lib/api-zod/src/generated/*` but does NOT necessarily rebuild the composite `dist`. So `tsc --noEmit` on api-server keeps reporting "Property 'X' does not exist" for a field that clearly exists in the generated `src` — because it is reading the stale `dist/*.d.ts`. Clearing `.tsbuildinfo` does not help; the stale artifact is the emitted `.d.ts`.

**How to apply:** after any openapi/codegen change that adds/changes a field, rebuild the referenced project's declarations before typechecking api-server:
`pnpm --filter @workspace/api-zod exec tsc --build --force`
The api-spec `codegen` script runs `pnpm -w run typecheck:libs` (`tsc --build`) which usually rebuilds it, but if you edit generated output out-of-band or typecheck api-server in isolation, force the composite build first.
