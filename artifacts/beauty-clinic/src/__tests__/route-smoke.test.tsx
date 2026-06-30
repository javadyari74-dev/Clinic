import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import App from "@/App";

const TOKEN_KEY = "clinic_auth_token";

// Mirrors the unsigned-payload shape the AuthProvider decodes from the JWT
// (only the middle segment is read). `role` + `permissions` drive every access
// decision, so varying them here lets us exercise the real gating logic.
function makeToken(
  role: "admin" | "staff" | "laser_operator",
  permissions: string[] = [],
): string {
  const payload = { sub: 1, username: role, role, permissions };
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

function makeAdminToken(): string {
  return makeToken("admin");
}

// One entry per authenticated route registered in App.tsx. `heading` is the
// page's own <h1> (matched by ARIA role to avoid colliding with the identical
// sidebar nav labels). `text` is used for routes that show a loading state
// instead of a heading on first paint (patient-detail).
type RouteCase = { path: string; heading?: string; text?: string };

const routes: RouteCase[] = [
  { path: "/", heading: "داشبورد" },
  { path: "/patients", heading: "مراجعین" },
  { path: "/patients/1", text: "در حال بارگذاری..." },
  { path: "/appointments", heading: "نوبت‌ها" },
  { path: "/payments", heading: "صندوق" },
  { path: "/services", heading: "خدمات" },
  { path: "/laser", heading: "بخش لیزر" },
  { path: "/staff", heading: "کارمندان" },
  { path: "/commissions", heading: "کمیسیون" },
  { path: "/commission-recipients", heading: "گیرندگان کمیسیون" },
  { path: "/discounts", heading: "تخفیفات" },
  { path: "/inventory", heading: "انبار" },
  { path: "/reports", heading: "گزارشات" },
  { path: "/reminders", heading: "یادآوری‌ها" },
  { path: "/backup", heading: "پشتیبان‌گیری" },
  { path: "/accounting", heading: "حسابداری و سود و زیان" },
  { path: "/users", heading: "مدیریت کاربران" },
];

beforeEach(() => {
  localStorage.setItem(TOKEN_KEY, makeAdminToken());
});

describe("authenticated routes load after the bundle split", () => {
  it.each(routes)(
    "navigates to $path and renders the page without erroring",
    async ({ path, heading, text }) => {
      window.history.pushState(null, "", path);
      render(<App />);

      if (heading) {
        expect(
          await screen.findByRole("heading", { name: heading }, { timeout: 5000 }),
        ).toBeInTheDocument();
      } else if (text) {
        expect(await screen.findByText(text, undefined, { timeout: 5000 })).toBeInTheDocument();
      }

      // A broken dynamic import would leave the route in the Suspense fallback;
      // a missing route would render NotFound. Guard against both.
      expect(screen.queryByText(/404 Page Not Found/i)).not.toBeInTheDocument();
    },
  );
});

// Directly validates the exact dynamic imports used by App.tsx. A renamed file
// or a missing `export default` surfaces here deterministically, independent of
// rendering.
const lazyModules: Record<string, () => Promise<{ default: unknown }>> = {
  "not-found": () => import("@/pages/not-found"),
  login: () => import("@/pages/login"),
  dashboard: () => import("@/pages/dashboard"),
  patients: () => import("@/pages/patients"),
  "patient-detail": () => import("@/pages/patient-detail"),
  appointments: () => import("@/pages/appointments"),
  payments: () => import("@/pages/payments"),
  services: () => import("@/pages/services"),
  staff: () => import("@/pages/staff"),
  commissions: () => import("@/pages/commissions"),
  "commission-recipients": () => import("@/pages/commission-recipients"),
  discounts: () => import("@/pages/discounts"),
  inventory: () => import("@/pages/inventory"),
  reports: () => import("@/pages/reports"),
  reminders: () => import("@/pages/reminders"),
  backup: () => import("@/pages/backup"),
  accounting: () => import("@/pages/accounting"),
  users: () => import("@/pages/users"),
  laser: () => import("@/pages/laser"),
};

describe("lazy page chunks expose a default component", () => {
  it.each(Object.entries(lazyModules))(
    "%s resolves to a component default export",
    async (_name, importer) => {
      const mod = await importer();
      expect(typeof mod.default).toBe("function");
    },
  );
});

// Sidebar nav labels (filtered by role/permission) — kept separate from the
// page <h1> text in `routes` above because the two collide. We query inside the
// <nav> landmark so a label only counts when it's an actual menu item.
const NAV_LABELS = {
  dashboard: "داشبورد",
  patients: "مراجعین",
  appointments: "نوبت‌ها",
  payments: "صندوق",
  services: "خدمات",
  laser: "لیزر",
  staff: "کارمندان",
  commissions: "کمیسیون",
  discounts: "تخفیفات",
  inventory: "انبار",
  accounting: "حسابداری و سود/زیان",
  reports: "گزارشات",
  reminders: "یادآوری‌ها",
  backup: "پشتیبان‌گیری",
  users: "مدیریت کاربران",
} as const;

describe("permission-gated sidebar reveals only allowed nav items", () => {
  it("a staff user sees only their permitted items (and never admin-only ones)", async () => {
    localStorage.setItem(TOKEN_KEY, makeToken("staff", ["patients", "appointments"]));
    window.history.pushState(null, "", "/patients");
    render(<App />);

    // Wait for the permitted landing page to mount so the sidebar is rendered.
    expect(
      await screen.findByRole("heading", { name: NAV_LABELS.patients }, { timeout: 5000 }),
    ).toBeInTheDocument();

    const nav = within(screen.getByRole("navigation"));
    expect(nav.getByText(NAV_LABELS.patients)).toBeInTheDocument();
    expect(nav.getByText(NAV_LABELS.appointments)).toBeInTheDocument();

    for (const key of ["dashboard", "payments", "services", "laser", "staff",
      "commissions", "discounts", "inventory", "accounting", "reports",
      "reminders", "backup", "users"] as const) {
      expect(nav.queryByText(NAV_LABELS[key])).not.toBeInTheDocument();
    }
  });

  it("a laser operator sees only the laser item", async () => {
    localStorage.setItem(TOKEN_KEY, makeToken("laser_operator"));
    window.history.pushState(null, "", "/laser");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "بخش لیزر" }, { timeout: 5000 }),
    ).toBeInTheDocument();

    const nav = within(screen.getByRole("navigation"));
    expect(nav.getByText(NAV_LABELS.laser)).toBeInTheDocument();

    for (const key of ["dashboard", "patients", "appointments", "payments",
      "services", "staff", "commissions", "discounts", "inventory",
      "accounting", "reports", "reminders", "backup", "users"] as const) {
      expect(nav.queryByText(NAV_LABELS[key])).not.toBeInTheDocument();
    }
  });
});

describe("restricted routes are not reachable by URL", () => {
  it("a laser operator landing on /staff does not see the staff page", async () => {
    localStorage.setItem(TOKEN_KEY, makeToken("laser_operator"));
    window.history.pushState(null, "", "/staff");
    render(<App />);

    // Redirected to the only page they may open; the staff page never renders.
    expect(
      await screen.findByRole("heading", { name: "بخش لیزر" }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: NAV_LABELS.staff })).not.toBeInTheDocument();
  });

  it("a staff user landing on an unpermitted route is redirected away from it", async () => {
    localStorage.setItem(TOKEN_KEY, makeToken("staff", ["patients"]));
    window.history.pushState(null, "", "/users");
    render(<App />);

    // First permitted nav item (مراجعین/patients) becomes the landing page.
    expect(
      await screen.findByRole("heading", { name: NAV_LABELS.patients }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "مدیریت کاربران" }),
    ).not.toBeInTheDocument();
  });
});
