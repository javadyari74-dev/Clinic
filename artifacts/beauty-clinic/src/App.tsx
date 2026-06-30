import { useEffect, lazy, Suspense, type ReactNode } from "react";
import {
  Switch,
  Route,
  Router as WouterRouter,
  Redirect,
  useLocation,
} from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { Layout, navItems, canAccessNavItem } from "@/components/layout";
import { ErrorBoundary } from "@/components/error-boundary";
import { AuthProvider, useAuth, type Permission } from "@/hooks/use-auth";
import { pageLoaders, prefetchCommonRoutes } from "@/lib/page-loaders";

const NotFound = lazy(pageLoaders.notFound);
const Login = lazy(pageLoaders.login);
const Dashboard = lazy(pageLoaders.dashboard);
const Patients = lazy(pageLoaders.patients);
const PatientDetail = lazy(pageLoaders.patientDetail);
const Appointments = lazy(pageLoaders.appointments);
const Payments = lazy(pageLoaders.payments);
const Services = lazy(pageLoaders.services);
const Staff = lazy(pageLoaders.staff);
const Commissions = lazy(pageLoaders.commissions);
const CommissionRecipients = lazy(pageLoaders.commissionRecipients);
const Discounts = lazy(pageLoaders.discounts);
const Inventory = lazy(pageLoaders.inventory);
const Reports = lazy(pageLoaders.reports);
const Reminders = lazy(pageLoaders.reminders);
const Backup = lazy(pageLoaders.backup);
const Accounting = lazy(pageLoaders.accounting);
const Users = lazy(pageLoaders.users);
const Laser = lazy(pageLoaders.laser);
const ClientErrors = lazy(pageLoaders.clientErrors);

function PageFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center py-24">
      <Spinner className="size-8 text-muted-foreground" />
    </div>
  );
}

// Exported so tests can reset the shared cache between renders; the app is the
// sole consumer at runtime.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function RedirectToLogin() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/login");
  }, [setLocation]);
  return null;
}

// The first nav destination the current user is actually allowed to open. Used
// as the redirect target when someone lands (e.g. via a typed URL or the post
// login redirect to "/") on a route their role/permissions don't cover.
function useFirstAllowedPath(): string | null {
  const { user, hasPermission } = useAuth();
  const item = navItems.find((i) =>
    canAccessNavItem(i, user?.role, hasPermission),
  );
  return item?.href ?? null;
}

// Route-level access control mirroring the sidebar visibility rules. Without it
// the sidebar only *hides* links — the pages themselves stay reachable by URL.
function Protected({
  permission,
  adminOnly,
  children,
}: {
  permission?: Permission;
  adminOnly?: boolean;
  children: ReactNode;
}) {
  const { user, hasPermission } = useAuth();
  const fallback = useFirstAllowedPath();
  const allowed = canAccessNavItem(
    { permission, adminOnly },
    user?.role,
    hasPermission,
  );
  if (allowed) return <>{children}</>;
  if (fallback) return <Redirect to={fallback} />;
  return (
    <div className="flex h-full w-full items-center justify-center py-24 text-muted-foreground">
      شما به این بخش دسترسی ندارید
    </div>
  );
}

function Router() {
  const { user } = useAuth();
  const [location] = useLocation();

  useEffect(() => {
    if (user) {
      prefetchCommonRoutes();
    }
  }, [user]);

  if (!user) {
    return (
      <Suspense fallback={<PageFallback />}>
        <Switch>
          <Route path="/login" component={Login} />
          <Route component={RedirectToLogin} />
        </Switch>
      </Suspense>
    );
  }

  return (
    <Layout>
      <ErrorBoundary resetKey={location}>
        <Suspense fallback={<PageFallback />}>
          <Switch>
            <Route path="/">
              <Protected permission="dashboard">
                <Dashboard />
              </Protected>
            </Route>
            <Route path="/patients">
              <Protected permission="patients">
                <Patients />
              </Protected>
            </Route>
            <Route path="/patients/:id">
              <Protected permission="patients">
                <PatientDetail />
              </Protected>
            </Route>
            <Route path="/appointments">
              <Protected permission="appointments">
                <Appointments />
              </Protected>
            </Route>
            <Route path="/payments">
              <Protected permission="payments">
                <Payments />
              </Protected>
            </Route>
            <Route path="/services">
              <Protected permission="services">
                <Services />
              </Protected>
            </Route>
            <Route path="/laser">
              <Protected permission="laser">
                <Laser />
              </Protected>
            </Route>
            <Route path="/staff">
              <Protected permission="staff">
                <Staff />
              </Protected>
            </Route>
            <Route path="/commissions">
              <Protected permission="commissions">
                <Commissions />
              </Protected>
            </Route>
            <Route path="/commission-recipients">
              <Protected permission="commissions">
                <CommissionRecipients />
              </Protected>
            </Route>
            <Route path="/discounts">
              <Protected permission="discounts">
                <Discounts />
              </Protected>
            </Route>
            <Route path="/inventory">
              <Protected permission="inventory">
                <Inventory />
              </Protected>
            </Route>
            <Route path="/reports">
              <Protected permission="reports">
                <Reports />
              </Protected>
            </Route>
            <Route path="/reminders">
              <Protected permission="reminders">
                <Reminders />
              </Protected>
            </Route>
            <Route path="/backup">
              <Protected permission="backup">
                <Backup />
              </Protected>
            </Route>
            <Route path="/accounting">
              <Protected permission="accounting">
                <Accounting />
              </Protected>
            </Route>
            <Route path="/users">
              <Protected adminOnly>
                <Users />
              </Protected>
            </Route>
            <Route path="/client-errors">
              <Protected adminOnly>
                <ClientErrors />
              </Protected>
            </Route>
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
