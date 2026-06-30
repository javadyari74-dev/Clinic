export const pageLoaders = {
  notFound: () => import("@/pages/not-found"),
  login: () => import("@/pages/login"),
  dashboard: () => import("@/pages/dashboard"),
  patients: () => import("@/pages/patients"),
  patientDetail: () => import("@/pages/patient-detail"),
  appointments: () => import("@/pages/appointments"),
  payments: () => import("@/pages/payments"),
  services: () => import("@/pages/services"),
  staff: () => import("@/pages/staff"),
  commissions: () => import("@/pages/commissions"),
  commissionRecipients: () => import("@/pages/commission-recipients"),
  discounts: () => import("@/pages/discounts"),
  inventory: () => import("@/pages/inventory"),
  reports: () => import("@/pages/reports"),
  reminders: () => import("@/pages/reminders"),
  backup: () => import("@/pages/backup"),
  accounting: () => import("@/pages/accounting"),
  users: () => import("@/pages/users"),
  laser: () => import("@/pages/laser"),
};

const routeLoaders: Record<string, () => Promise<unknown>> = {
  "/": pageLoaders.dashboard,
  "/patients": pageLoaders.patients,
  "/appointments": pageLoaders.appointments,
  "/payments": pageLoaders.payments,
  "/services": pageLoaders.services,
  "/laser": pageLoaders.laser,
  "/staff": pageLoaders.staff,
  "/commissions": pageLoaders.commissions,
  "/commission-recipients": pageLoaders.commissionRecipients,
  "/discounts": pageLoaders.discounts,
  "/inventory": pageLoaders.inventory,
  "/accounting": pageLoaders.accounting,
  "/reports": pageLoaders.reports,
  "/reminders": pageLoaders.reminders,
  "/backup": pageLoaders.backup,
  "/users": pageLoaders.users,
};

const prefetched = new Set<string>();

export function prefetchRoute(href: string) {
  const loader = routeLoaders[href];
  if (!loader || prefetched.has(href)) return;
  prefetched.add(href);
  loader().catch(() => {
    prefetched.delete(href);
  });
}

const idlePrefetchOrder = ["/patients", "/appointments", "/payments"];

export function prefetchCommonRoutes() {
  const run = () => {
    for (const href of idlePrefetchOrder) {
      prefetchRoute(href);
    }
  };

  const w = window as typeof window & {
    requestIdleCallback?: (cb: () => void) => number;
  };

  if (typeof w.requestIdleCallback === "function") {
    w.requestIdleCallback(run);
  } else {
    setTimeout(run, 2000);
  }
}
