import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Component, type ReactNode } from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import App, { queryClient } from "@/App";
import { ERROR_NOTICE_TITLE } from "@/components/error-notice";
import {
  mockApiFetch,
  makeMockApiFetch,
  PATIENT_ONE_NAME,
  STAFF_NAME,
  SERVICE_NAME,
  RECIPIENT_NAME,
  DISCOUNT_NAME,
  INVENTORY_NAME,
  REMINDER_TITLE,
  USER_NAME,
  LASER_CLIENT_NAME,
} from "./api-fixtures";

const TOKEN_KEY = "clinic_auth_token";

function makeAdminToken(): string {
  const payload = { sub: 1, username: "admin", role: "admin", permissions: [] };
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

// App has no error boundary, so a render crash after data arrives would throw
// straight out of `render()`. Wrapping it in a recording boundary turns that
// into a precise, attributable failure (with the original stack) instead of an
// opaque timeout, and still lets us assert that nothing was caught.
class CrashRecorder extends Component<
  { children: ReactNode; onCrash: (e: Error) => void },
  { crashed: boolean }
> {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onCrash(error);
  }
  render() {
    return this.state.crashed ? null : this.props.children;
  }
}

// One entry per authenticated route. `marker` is a value that ONLY appears once
// the page has rendered its mocked data (a table cell, stat, chart label), so
// finding it proves the page reached its loaded state without crashing. `backup`
// loads no data on mount, so it asserts its static heading instead.
type RouteCase = { path: string; marker: string | RegExp; role?: "heading" };

const routes: RouteCase[] = [
  { path: "/", marker: REMINDER_TITLE },
  { path: "/patients", marker: PATIENT_ONE_NAME },
  { path: "/patients/1", marker: PATIENT_ONE_NAME },
  { path: "/appointments", marker: PATIENT_ONE_NAME },
  { path: "/payments", marker: PATIENT_ONE_NAME },
  { path: "/services", marker: SERVICE_NAME },
  { path: "/laser", marker: LASER_CLIENT_NAME },
  { path: "/staff", marker: STAFF_NAME },
  { path: "/commissions", marker: STAFF_NAME },
  { path: "/commission-recipients", marker: RECIPIENT_NAME },
  { path: "/discounts", marker: DISCOUNT_NAME },
  { path: "/inventory", marker: INVENTORY_NAME },
  // Reports renders low-stock items as "<name> — <qty> <unit>" in a single
  // badge, so match the name as a substring.
  { path: "/reports", marker: new RegExp(INVENTORY_NAME) },
  // Reminders' default tab is "birthday"; the upcoming-birthday list shows the
  // patient name. (The follow-up title lives in a non-default tab.)
  { path: "/reminders", marker: new RegExp(PATIENT_ONE_NAME) },
  // Accounting's default tab is "chart"; the expenses-by-category breakdown is
  // always visible there. (Per-service profit lives in a non-default tab.)
  { path: "/accounting", marker: /اجاره/ },
  { path: "/users", marker: USER_NAME },
  { path: "/backup", marker: "پشتیبان‌گیری", role: "heading" },
];

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.setItem(TOKEN_KEY, makeAdminToken());
  vi.stubGlobal("fetch", vi.fn(mockApiFetch));
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  // App's QueryClient is module-scoped and therefore shared across every test
  // in this file. Without clearing it, data cached by an earlier test (e.g. a
  // populated patient) would be served to a later empty/error test, masking the
  // very crash those tests exist to catch.
  queryClient.clear();
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  vi.unstubAllGlobals();
});

describe("authenticated routes render with real data without crashing", () => {
  it.each(routes)(
    "renders $path in its loaded state",
    async ({ path, marker, role }) => {
      window.history.pushState(null, "", path);

      let crash: Error | null = null;
      render(
        <CrashRecorder onCrash={(e) => (crash = e)}>
          <App />
        </CrashRecorder>,
      );

      // Resolve as soon as the data marker renders; re-throw immediately if the
      // page crashed so the failure carries the real error, not a timeout.
      await waitFor(
        () => {
          if (crash) throw crash;
          if (role === "heading") {
            expect(
              screen.getByRole("heading", { name: marker }),
            ).toBeInTheDocument();
          } else {
            expect(screen.getAllByText(marker).length).toBeGreaterThan(0);
          }
        },
        { timeout: 5000 },
      );

      expect(crash).toBeNull();
      expect(screen.queryByText(/404 Page Not Found/i)).not.toBeInTheDocument();

      // React logs caught render errors via console.error even when an error
      // boundary swallows them. Fail on any console.error whose first argument
      // is an Error (a genuine crash), while tolerating string dev warnings
      // (act(), key props, recharts dimension notices) that are not crashes.
      const realErrors = consoleErrorSpy.mock.calls.filter((args) =>
        args.some((a) => a instanceof Error),
      );
      expect(realErrors).toEqual([]);
    },
  );
});

// Resilience cases: render every route against (a) every endpoint returning the
// empty-but-valid shape, and (b) every endpoint returning a 500. `marker` is a
// stable, data-independent anchor (almost always the page's own <h1>) proving
// the page reached its rendered shell — not a blank screen — without crashing.
// patient-detail is the one page that gates its <h1> behind the loaded record,
// so it gets explicit per-mode markers.
type ResilienceCase = {
  path: string;
  emptyMarker: string | RegExp;
  errorMarker: string | RegExp;
  // How to locate the empty-mode marker. "heading" matches the page <h1> by
  // role (sidebar nav labels collide as plain text); "text" matches any text
  // node.
  by?: "heading" | "text";
  // How to locate the error-mode marker. Defaults to "text" because the error
  // notice renders as a text node, not the page <h1>.
  errorBy?: "heading" | "text";
};

// In error mode every endpoint returns 500, so each page's primary query goes
// to its isError state and renders the shared error notice instead of a blank
// table. The error notice title is therefore the error-mode marker for every
// data-loading route. The one exception is `/backup`, which loads no data on
// mount and so has no failing query — it still asserts its static heading.
const resilienceRoutes: ResilienceCase[] = [
  { path: "/", emptyMarker: "داشبورد", errorMarker: ERROR_NOTICE_TITLE, by: "heading" },
  { path: "/patients", emptyMarker: "مراجعین", errorMarker: ERROR_NOTICE_TITLE, by: "heading" },
  // Detail page: empty = record exists but has no related rows (name still
  // shows); error = the record fetch fails and the page shows the error notice.
  { path: "/patients/1", emptyMarker: PATIENT_ONE_NAME, errorMarker: ERROR_NOTICE_TITLE, by: "text" },
  { path: "/appointments", emptyMarker: "نوبت‌ها", errorMarker: ERROR_NOTICE_TITLE, by: "heading" },
  { path: "/payments", emptyMarker: "صندوق", errorMarker: ERROR_NOTICE_TITLE, by: "heading" },
  { path: "/services", emptyMarker: "خدمات", errorMarker: ERROR_NOTICE_TITLE, by: "heading" },
  { path: "/laser", emptyMarker: "بخش لیزر", errorMarker: ERROR_NOTICE_TITLE, by: "heading" },
  { path: "/staff", emptyMarker: "کارمندان", errorMarker: ERROR_NOTICE_TITLE, by: "heading" },
  { path: "/commissions", emptyMarker: "کمیسیون", errorMarker: ERROR_NOTICE_TITLE, by: "heading" },
  { path: "/commission-recipients", emptyMarker: "گیرندگان کمیسیون", errorMarker: ERROR_NOTICE_TITLE, by: "heading" },
  { path: "/discounts", emptyMarker: "تخفیفات", errorMarker: ERROR_NOTICE_TITLE, by: "heading" },
  { path: "/inventory", emptyMarker: "انبار", errorMarker: ERROR_NOTICE_TITLE, by: "heading" },
  { path: "/reports", emptyMarker: "گزارشات", errorMarker: ERROR_NOTICE_TITLE, by: "heading" },
  { path: "/reminders", emptyMarker: "یادآوری‌ها", errorMarker: ERROR_NOTICE_TITLE, by: "heading" },
  { path: "/accounting", emptyMarker: "حسابداری و سود و زیان", errorMarker: ERROR_NOTICE_TITLE, by: "heading" },
  { path: "/users", emptyMarker: "مدیریت کاربران", errorMarker: ERROR_NOTICE_TITLE, by: "heading" },
  // backup loads no data on mount, so an all-500 backend produces no error
  // notice — it still renders its static heading.
  { path: "/backup", emptyMarker: "پشتیبان‌گیری", errorMarker: "پشتیبان‌گیری", by: "heading", errorBy: "heading" },
];

// Drives one render of `path` with `fetch` stubbed for `mode`, waits until the
// page settles on `marker`, lets React Query's retries flush so any error-state
// branch actually runs, and fails on a render crash or an Error logged to the
// console.
async function assertRouteResilient(
  path: string,
  marker: string | RegExp,
  by: "heading" | "text",
) {
  window.history.pushState(null, "", path);

  let crash: Error | null = null;
  render(
    <CrashRecorder onCrash={(e) => (crash = e)}>
      <App />
    </CrashRecorder>,
  );

  await waitFor(
    () => {
      if (crash) throw crash;
      if (by === "heading") {
        expect(
          screen.getAllByRole("heading", { name: marker }).length,
        ).toBeGreaterThan(0);
      } else {
        expect(screen.getAllByText(marker).length).toBeGreaterThan(0);
      }
    },
    { timeout: 8000 },
  );

  // The shell rendered, but queries may still be retrying (retry: 1, ~1s
  // backoff). Flush that window inside act() so a crash that only appears in the
  // post-error/empty render path is still caught, then re-check. Wrapped in
  // act() so the post-retry re-render is fully applied before we assert.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1500));
  });
  if (crash) throw crash;

  expect(crash).toBeNull();
  expect(screen.queryByText(/404 Page Not Found/i)).not.toBeInTheDocument();

  const realErrors = consoleErrorSpy.mock.calls.filter((args) =>
    args.some((a) => a instanceof Error),
  );
  expect(realErrors).toEqual([]);
}

describe("authenticated routes render an empty state without crashing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(makeMockApiFetch("empty")));
  });

  it.each(resilienceRoutes)(
    "renders $path with all endpoints empty",
    async ({ path, emptyMarker, by }) => {
      await assertRouteResilient(path, emptyMarker, by ?? "heading");
    },
    15000,
  );
});

describe("authenticated routes render an error state without crashing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(makeMockApiFetch("error")));
  });

  it.each(resilienceRoutes)(
    "renders $path when every endpoint returns 500",
    async ({ path, errorMarker, errorBy }) => {
      await assertRouteResilient(path, errorMarker, errorBy ?? "text");
    },
    15000,
  );
});
