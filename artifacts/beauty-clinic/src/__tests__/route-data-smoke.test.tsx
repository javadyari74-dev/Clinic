import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Component, type ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import App from "@/App";
import {
  mockApiFetch,
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
