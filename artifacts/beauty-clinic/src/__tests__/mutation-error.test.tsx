import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App, { queryClient } from "@/App";
import {
  makeMockApiFetchFailingMutations,
  PATIENT_ONE_NAME,
  SERVICE_NAME,
} from "./api-fixtures";

// Write-path resilience: every create dialog is opened against a backend that
// serves good data on GET (so the dialog has real options to pick) but rejects
// the save with a 500. A rejected mutation must surface a friendly error toast
// and leave the dialog open and editable — never wedge it, lose the input, or
// crash the page.

const TOKEN_KEY = "clinic_auth_token";

function makeAdminToken(): string {
  const payload = { sub: 1, username: "admin", role: "admin", permissions: [] };
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

function useFailingFetch(method: string, pattern: RegExp) {
  vi.stubGlobal(
    "fetch",
    vi.fn(makeMockApiFetchFailingMutations([{ method, pattern }])),
  );
}

beforeEach(() => {
  localStorage.setItem(TOKEN_KEY, makeAdminToken());
  // App's QueryClient is module-scoped and shared across tests; clear it so a
  // page always re-fetches against the current stubbed fetch.
  queryClient.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function dialog() {
  return screen.getByRole("dialog");
}

describe("create dialogs survive a failed save (500) without crashing", () => {
  it("patient create: shows an error toast and keeps the dialog open", async () => {
    useFailingFetch("POST", /\/api\/patients$/);
    const user = userEvent.setup();
    window.history.pushState(null, "", "/patients");
    render(<App />);

    // Page loaded with real data.
    expect(
      await screen.findByRole("heading", { name: "مراجعین" }, { timeout: 5000 }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /مراجع جدید/ }));
    const d = await screen.findByRole("dialog");
    expect(within(d).getByText("ثبت مراجع جدید")).toBeInTheDocument();

    await user.type(within(d).getByLabelText(/نام و نام خانوادگی/), "تست مراجع");
    await user.type(within(d).getByLabelText(/شماره تماس/), "09120009999");
    await user.type(within(d).getByLabelText(/شماره پرونده/), "P-999");

    await user.click(within(d).getByRole("button", { name: "ثبت اطلاعات" }));

    expect(
      await screen.findByText("ثبت مراجع ناموفق بود", undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    // Dialog still open and the typed value is preserved.
    expect(dialog()).toBeInTheDocument();
    expect(within(dialog()).getByDisplayValue("تست مراجع")).toBeInTheDocument();
    expect(screen.queryByText(/404 Page Not Found/i)).not.toBeInTheDocument();
  });

  it("payment create: shows an error toast and keeps the dialog open", async () => {
    useFailingFetch("POST", /\/api\/payments$/);
    const user = userEvent.setup();
    window.history.pushState(null, "", "/payments");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "صندوق" }, { timeout: 5000 }),
    ).toBeInTheDocument();

    // Header "new payment" button (the submit button shares its label but only
    // exists once the dialog is open).
    await user.click(screen.getAllByRole("button", { name: /ثبت پرداخت/ })[0]);
    const d = await screen.findByRole("dialog");
    expect(within(d).getByText("ثبت پرداخت جدید")).toBeInTheDocument();

    // originalAmount is the only hard-required field (min 1); appointment is
    // optional and amount may be 0.
    await user.type(within(d).getByLabelText(/مبلغ اصلی/), "500000");
    await user.click(within(d).getByRole("button", { name: "ثبت پرداخت" }));

    expect(
      await screen.findByText("ثبت پرداخت ناموفق بود", undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(dialog()).toBeInTheDocument();
    // Typed amount is preserved (the field is mirrored into "amount paid", so
    // the value appears more than once — assert it survived rather than its
    // exact cardinality).
    expect(within(dialog()).getAllByDisplayValue("500000").length).toBeGreaterThan(0);
    expect(screen.queryByText(/404 Page Not Found/i)).not.toBeInTheDocument();
  });

  it("appointment create: shows an error toast and keeps the dialog open", async () => {
    useFailingFetch("POST", /\/api\/appointments$/);
    // Radix leaves `pointer-events: none` on <body> momentarily after the
    // patient popover closes; skip the pointer-events guard so the subsequent
    // Select interaction isn't blocked in jsdom.
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    window.history.pushState(null, "", "/appointments");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "نوبت‌ها" }, { timeout: 5000 }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /نوبت جدید/ }));
    const d = await screen.findByRole("dialog");
    expect(within(d).getByText("ثبت نوبت جدید")).toBeInTheDocument();

    // Patient: open the combobox, then pick the patient option.
    await user.click(within(d).getByText(/جستجو با نام/));
    await user.click(
      await screen.findByRole("option", { name: new RegExp(PATIENT_ONE_NAME) }),
    );

    // Service: open the Select, then pick the service option.
    await user.click(within(d).getByText("انتخاب خدمت"));
    await user.click(await screen.findByRole("option", { name: SERVICE_NAME }));

    // Date and time are pre-filled with defaults, so the form is submittable.
    await user.click(within(d).getByRole("button", { name: /ثبت نوبت/ }));

    expect(
      await screen.findByText("ثبت نوبت ناموفق بود", undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(dialog()).toBeInTheDocument();
    expect(screen.queryByText(/404 Page Not Found/i)).not.toBeInTheDocument();
  });

  it("expense create: shows an error toast and keeps the dialog open", async () => {
    useFailingFetch("POST", /\/api\/accounting\/expenses$/);
    const user = userEvent.setup();
    window.history.pushState(null, "", "/accounting");
    render(<App />);

    expect(
      await screen.findByRole(
        "heading",
        { name: "حسابداری و سود و زیان" },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /ثبت هزینه/ }));
    const d = await screen.findByRole("dialog");
    expect(within(d).getByText("ثبت هزینه جدید")).toBeInTheDocument();

    // Category defaults to "salary" and the date defaults to today; only amount
    // and description need filling.
    await user.type(within(d).getByPlaceholderText(/5000000/), "1500000");
    await user.type(within(d).getByPlaceholderText(/اجاره ماه تیر/), "هزینه تست");
    await user.click(within(d).getByRole("button", { name: "ثبت هزینه" }));

    expect(
      await screen.findByText("ثبت هزینه ناموفق بود", undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(dialog()).toBeInTheDocument();
    expect(within(dialog()).getByDisplayValue("هزینه تست")).toBeInTheDocument();
    expect(screen.queryByText(/404 Page Not Found/i)).not.toBeInTheDocument();
  });

  it("reminder create: shows an error toast and keeps the dialog open", async () => {
    useFailingFetch("POST", /\/api\/reminders$/);
    const user = userEvent.setup();
    window.history.pushState(null, "", "/patients/1");
    render(<App />);

    // Patient-detail gates its heading behind the loaded record.
    expect(
      await screen.findAllByText(
        new RegExp(PATIENT_ONE_NAME),
        undefined,
        { timeout: 5000 },
      ),
    ).not.toHaveLength(0);

    // The reminder dialog is opened from the bell button on an appointment row.
    const bell = await screen.findByTitle("ثبت یادآوری");
    await user.click(bell);
    const d = await screen.findByRole("dialog");
    // "ثبت یادآوری" appears as both the title and the submit button, so anchor
    // the open dialog on the date-picker placeholder instead.
    expect(within(d).getByText("انتخاب تاریخ سررسید")).toBeInTheDocument();

    // Title is auto-filled; a due date must be chosen via the Persian date
    // picker. Open it and pick today's cell.
    await user.click(within(d).getByText("انتخاب تاریخ سررسید"));
    const today = await waitFor(() => {
      const el = document.querySelector(
        ".rmdp-day.rmdp-today span, .rmdp-day:not(.rmdp-disabled):not(.rmdp-day-hidden) span",
      );
      if (!el) throw new Error("date picker did not open");
      return el as HTMLElement;
    });
    await user.click(today);

    await user.click(within(d).getByRole("button", { name: /ثبت یادآوری/ }));

    expect(
      await screen.findByText("خطا در ثبت یادآوری", undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(dialog()).toBeInTheDocument();
    expect(screen.queryByText(/404 Page Not Found/i)).not.toBeInTheDocument();
  });
});
