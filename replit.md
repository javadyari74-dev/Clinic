# مطب زیبایی دکتر یاری (Doctor Yari Beauty Clinic)

A Persian/RTL clinic management system: patients, appointments, payments, commissions, discounts, inventory, reminders, laser module, staff, and account/wallet balances. Ported from the user's existing app so they can continue editing it here.

## Run & Operate

Artifacts run as managed workflows (do not add duplicate workflows):
- `artifacts/api-server: API Server` — Express API (`pnpm --filter @workspace/api-server run dev`)
- `artifacts/beauty-clinic: web` — React+Vite frontend (`pnpm --filter @workspace/beauty-clinic run dev`)

Other useful commands:
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas from the OpenAPI spec (run after editing `lib/api-spec/openapi.yaml`). Also runs `typecheck:libs`.
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm run typecheck` — full typecheck across all packages

## Stack

- pnpm workspaces, Node.js, TypeScript
- API: Express 5
- DB: **SQLite** via `@libsql/client` + `drizzle-orm/libsql` (self-contained `clinic.db`). No external DB to provision — the API server auto-runs migrations and seeds on startup. **Do not convert to Postgres.**
- Auth: in-app username/password, **JWT bearer tokens** stored client-side in `localStorage` (`clinic_auth_token`); the client attaches `Authorization: Bearer` via `setAuthTokenGetter`. Seeds `admin` / `admin123` on first startup.
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from `lib/api-spec/openapi.yaml`)
- Build: esbuild (dev build does NOT typecheck — run `pnpm run typecheck` separately)

## Where things live

- DB schema (source of truth): `lib/db/src/schema/` + migrations in `lib/db/migrations/` (journaled; the server replays them on startup).
- API contract (source of truth): `lib/api-spec/openapi.yaml` → generates `lib/api-zod` (server validation) and `lib/api-client-react` (frontend hooks).
- API routes: `artifacts/api-server/src/routes/`
- Frontend pages: `artifacts/beauty-clinic/src/pages/`
- Real data auto-backups (restorable via the in-app backup UI after login): `backups/`

## Architecture decisions

- Kept SQLite (faithful to the original app); no Postgres.
- Adding/changing an API endpoint means editing `openapi.yaml` then running codegen — the zod schemas and React hooks the routes/pages import are generated, not hand-written.
- Adding a DB column/table requires both a schema file change AND a new journaled migration in `lib/db/migrations/` (the server only replays journaled `.sql` files on startup).

## Product

Full clinic back-office: patient records, appointment scheduling, payment/receipts, referral commissions, patient wallet/account balances, discounts, inventory, reminders, and a laser-treatment module — all in Persian with a right-to-left layout.

## User preferences

- No scrolling anywhere in the app (vertical or horizontal). Dialogs/forms must fit within the viewport — prefer wider multi-column layouts, compact spacing, and `overflow-x-hidden` over scrollable containers.

## Gotchas

- After editing `openapi.yaml`, always run `pnpm --filter @workspace/api-spec run codegen`, or the routes/pages will import non-existent generated symbols.
- The dev build uses esbuild (no typechecking). Run `pnpm run typecheck` to catch type errors; a couple of pre-existing type-only warnings (e.g. a drizzle overload in `laser.ts`) don't block the build or runtime.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
