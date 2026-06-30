import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "@/App";

const TOKEN_KEY = "clinic_auth_token";

function makeAdminToken(): string {
  const payload = { sub: 1, username: "admin", role: "admin", permissions: [] };
  return `header.${btoa(JSON.stringify(payload))}.signature`;
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
