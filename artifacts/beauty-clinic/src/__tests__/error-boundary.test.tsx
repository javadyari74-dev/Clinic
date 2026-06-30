import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

// Replace the dashboard page loader with a component that throws on render so
// the "/" route crashes the way a real broken page would. Every other loader
// (and prefetch/route helpers used by App + the sidebar) is kept intact via the
// spread, so the rest of the shell still works and the boundary can reset onto
// a healthy page.
vi.mock("@/lib/page-loaders", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/page-loaders")>();
  function CrashingPage(): never {
    throw new Error("forced render crash for error-boundary test");
  }
  return {
    ...actual,
    pageLoaders: {
      ...actual.pageLoaders,
      dashboard: () => Promise.resolve({ default: CrashingPage }),
    },
  };
});

// Imported after vi.mock so App picks up the crashing dashboard loader.
import App from "@/App";

const TOKEN_KEY = "clinic_auth_token";

function makeAdminToken(): string {
  const payload = { sub: 1, username: "admin", role: "admin", permissions: [] };
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

// The boundary's Persian fallback strings (kept in sync with
// components/error-boundary.tsx). A regression that removes/changes them — or
// the boundary itself — fails these assertions instead of silently shipping a
// blank screen.
const FALLBACK_HEADING = "مشکلی در این صفحه پیش آمد";
const RELOAD_BUTTON = "بارگذاری مجدد";
const DASHBOARD_BUTTON = "بازگشت به داشبورد";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.setItem(TOKEN_KEY, makeAdminToken());
  // React logs caught render errors to console.error; silence it so the forced
  // crash doesn't spam the test output.
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("error boundary catches a crashing page", () => {
  it("shows the Persian fallback (not a blank screen) when a page throws on render", async () => {
    window.history.pushState(null, "", "/");
    render(<App />);

    // The friendly fallback renders instead of the blank screen a propagated
    // crash would leave behind.
    expect(
      await screen.findByText(FALLBACK_HEADING, undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: RELOAD_BUTTON }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: DASHBOARD_BUTTON }),
    ).toBeInTheDocument();

    // The crash is contained to the page area — the surrounding shell (sidebar
    // nav) is still rendered and usable, which is the whole point of the
    // boundary living inside the Layout rather than at the root.
    const nav = within(screen.getByRole("navigation"));
    expect(nav.getByText("مراجعین")).toBeInTheDocument();
  });

  it("resets and shows content again after navigating to another route", async () => {
    window.history.pushState(null, "", "/");
    render(<App />);

    // Confirm we're on the crash screen first.
    expect(
      await screen.findByText(FALLBACK_HEADING, undefined, { timeout: 5000 }),
    ).toBeInTheDocument();

    // Use the still-usable sidebar to navigate to a healthy page. The route
    // change updates the boundary's resetKey, so it clears its error state.
    const nav = within(screen.getByRole("navigation"));
    fireEvent.click(nav.getByText("مراجعین"));

    // The healthy patients page renders its own heading (matched by role to
    // avoid colliding with the identical sidebar label)...
    expect(
      await screen.findByRole(
        "heading",
        { name: "مراجعین" },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    // ...and the fallback is gone.
    expect(screen.queryByText(FALLBACK_HEADING)).not.toBeInTheDocument();
  });
});
