import { useEffect, lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { Layout } from "@/components/layout";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
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

function PageFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center py-24">
      <Spinner className="size-8 text-muted-foreground" />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function RedirectToLogin() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/login"); }, [setLocation]);
  return null;
}

function Router() {
  const { user } = useAuth();

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
      <Suspense fallback={<PageFallback />}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/patients" component={Patients} />
          <Route path="/patients/:id" component={PatientDetail} />
          <Route path="/appointments" component={Appointments} />
          <Route path="/payments" component={Payments} />
          <Route path="/services" component={Services} />
          <Route path="/laser" component={Laser} />
          <Route path="/staff" component={Staff} />
          <Route path="/commissions" component={Commissions} />
          <Route path="/commission-recipients" component={CommissionRecipients} />
          <Route path="/discounts" component={Discounts} />
          <Route path="/inventory" component={Inventory} />
          <Route path="/reports" component={Reports} />
          <Route path="/reminders" component={Reminders} />
          <Route path="/backup" component={Backup} />
          <Route path="/accounting" component={Accounting} />
          <Route path="/users" component={Users} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
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
