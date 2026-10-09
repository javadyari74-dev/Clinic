import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App, { queryClient } from "@/App";
import { makeMockApiFetch, PATIENT_ONE_NAME } from "./api-fixtures";

// A refused delete (e.g. the appointment already has payments) must surface
// the server's Persian reason in a toast — not fail silently.

const TOKEN_KEY = "clinic_auth_token";
const SERVER_MESSAGE = "این نوبت دارای پرداخت ثبت‌شده است و قابل حذف نیست";

function makeAdminToken(): string {
  const payload = { sub: 1, username: "admin", role: "admin", permissions: [] };
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

function pathOf(input: RequestInfo | URL): string {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, "http://localhost").pathname;
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
}

beforeEach(() => {
  localStorage.setItem(TOKEN_KEY, makeAdminToken());
  queryClient.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("appointment delete failure", () => {
  it("shows the server's error message in a toast", async () => {
    const base = makeMockApiFetch("populated");
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (methodOf(input, init) === "DELETE" && /\/api\/appointments\/\d+$/.test(pathOf(input))) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: SERVER_MESSAGE }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return base(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    window.history.pushState(null, "", "/appointments");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "نوبت‌ها" }, { timeout: 5000 }),
    ).toBeInTheDocument();

    const row = (await screen.findAllByText(PATIENT_ONE_NAME, undefined, { timeout: 5000 }))
      .map((el) => el.closest("tr"))
      .find((tr): tr is HTMLTableRowElement => !!tr && !!within(tr).queryByRole("button", { name: "حذف نوبت" }));
    expect(row).toBeTruthy();

    await user.click(within(row!).getByRole("button", { name: "حذف نوبت" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "حذف" }));

    expect(
      await screen.findByText(SERVER_MESSAGE, undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("حذف نوبت ناموفق بود")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => methodOf(input, init) === "DELETE" && /\/api\/appointments\/\d+$/.test(pathOf(input)),
      ),
    ).toBe(true);
  });
});
