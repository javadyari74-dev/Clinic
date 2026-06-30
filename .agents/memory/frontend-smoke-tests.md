---
name: Frontend smoke tests (beauty-clinic)
description: How the beauty-clinic web app's vitest/jsdom route smoke tests are set up and the quirks that shaped them.
---

# Beauty-clinic frontend smoke tests

Vitest + jsdom + Testing Library live in `artifacts/beauty-clinic`. Config is
`vitest.config.ts` (separate from `vite.config.ts`, which throws without PORT/BASE_PATH).
Run with `pnpm --filter @workspace/beauty-clinic test`. Registered as the `test`
validation command. Setup file polyfills matchMedia / ResizeObserver /
IntersectionObserver / pointer-capture / scrollIntoView for Radix + recharts.

## Route smoke test decisions (route-smoke.test.tsx)

- **Never-resolving `fetch` stub** keeps every react-query/raw-fetch call in its
  loading state. **Why:** endpoints return mixed shapes (arrays vs `{data:[]}` vs
  objects); resolving with one empty shape crashes some pages. Pending = pages show
  skeletons and mount without touching data, which is exactly what a chunk-load smoke
  test needs.
- **Assert the page `<h1>` via `findByRole("heading", {name})`, not `findByText`.**
  **Why:** the sidebar nav renders the *same* Persian labels (e.g. "مراجعین") as
  `<span>`s, so `findByText` matches multiple nodes. Role "heading" excludes the nav.
- **patient-detail gates its heading behind `isLoading`**, so with the pending fetch
  it shows the loading text "در حال بارگذاری..." — assert that instead of an h1.
- Auth is faked by writing a hand-built JWT (`header.<btoa(payload)>.sig`, role admin)
  to localStorage key `clinic_auth_token` before render; admin sees every route.
- A second describe block imports each `@/pages/*` module used by App.tsx's
  `React.lazy` and asserts `typeof mod.default === "function"` — deterministic guard
  for renamed files / missing default exports, independent of rendering.

**How to apply:** when adding pages/routes, add a matching entry to the `routes` and
`lazyModules` tables. If a new page early-returns a loading state before its heading,
assert its loading text rather than the heading.
