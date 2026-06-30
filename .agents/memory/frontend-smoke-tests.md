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

## Loaded-state smoke test (route-data-smoke.test.tsx)

Sibling test that asserts pages render their *loaded* state (catches `.map`/field
crashes the never-resolving stub can't). A single URL-aware `fetch` mock
(`api-fixtures.ts`) covers every page — generated react-query hooks, the
`use-accounting` hook, and raw `fetch` in users/laser/backup all route through
global `fetch`, so one mock that matches on `URL.pathname` is enough.

- **List endpoint shapes are inconsistent and must be matched exactly or pages
  crash:** `/patients` and `/appointments` (incl. `/patients/:id/appointments`,
  waiting-list) return `{data,total,...}`; almost everything else (`/payments`,
  `/services`, `/staff`, `/inventory`, `/discounts`, `/commissions`,
  `/commission-recipients`, `/reminders`, `/activity`, account-transactions,
  notes) returns a **bare array**. `/reports/summary`, `/dashboard/summary`,
  `/accounting/*`, `/commission-recipients/:id/referrals` are objects.
- **App.tsx has no error boundary**, so a post-load render crash throws out of
  `render()`. The test wraps `<App/>` in a recording boundary and re-throws the
  caught error inside `waitFor` — failures carry the real stack, not a timeout.
- **Markers must target each page's default tab.** Radix `TabsContent` unmounts
  inactive tabs, so data in a non-default tab never renders: accounting defaults
  to "chart" (per-service is hidden), reminders defaults to "birthday" (follow-up
  list hidden — assert the upcoming-birthday patient name instead). Use a regex
  marker when the value is concatenated with other text in one node (testing-lib
  `getByText` only joins an element's *direct* text nodes).
- Reminder type buckets use `"followup"` (no underscore), not `"follow_up"`.

**How to apply:** new page → add a `{path, marker}` row whose marker is a value
rendered in the page's *default* view, and add its on-mount endpoints to
`api-fixtures.ts` `routes` (most-specific path regex first). Default fallthrough
returns `[]`, so a forgotten object endpoint surfaces as an assertion failure.

## Error-state smoke (route-data-smoke.test.tsx error suite)

`api-fixtures.ts` `error` mode returns 500 for **every** endpoint. Each page's
primary query reaches its `isError` branch and renders the shared `ErrorNotice`
(`ERROR_NOTICE_TITLE`), so the error-mode marker for every data-loading route is
that title, asserted by **text** (the notice title is an `<h5>`/AlertTitle, not the
page `<h1>` — locating by "heading" collides with the page h1). React Query uses
`retry:1`, so the notice only appears after retries flush — the helper already
advances ~1.5s inside `act()`.

- **`/backup` is the lone exception:** it loads no data on mount, so an all-500
  backend produces no failing query and no notice — it still asserts its static
  heading (`errorBy:"heading"`).
- **patient-detail error ≠ not-found.** Its `isError` branch shows the notice;
  the separate `!patient` branch shows "مراجع یافت نشد". Error mode 500s the
  `/patients/:id` fetch → notice, not the not-found text.

**How to apply:** new data-loading page → wire `{isError && <ErrorNotice
onRetry={refetch}/>}` after its header, and the existing error-suite row will
assert the notice automatically (default `errorBy` is "text"). Only set
`errorBy:"heading"` for pages that fetch nothing on mount.
