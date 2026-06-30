import { useEffect, lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { Layout } from "@/components/layout";
import { AuthProvider, useAuth } from "@/hooks/use-auth";

const NotFound = lazy(() => import("@/pages/not-found"));
const Login = lazy(() => import("@/pages/login"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Patients = lazy(() => import("@/pages/patients"));
const PatientDetail = lazy(() => import("@/pages/patient-detail"));
const Appointments = lazy(() => import("@/pages/appointments"));
const Payments = lazy(() => import("@/pages/payments"));
const Services = lazy(() => import("@/pages/services"));
const Staff = lazy(() => import("@/pages/staff"));
const Commissions = lazy(() => import("@/pages/commissions"));
const CommissionRecipients = lazy(() => import("@/pages/commission-recipients"));
const Discounts = lazy(() => import("@/pages/discounts"));
const Inventory = lazy(() => import("@/pages/inventory"));
const Reports = lazy(() => import("@/pages/reports"));
const Reminders = lazy(() => import("@/pages/reminders"));
const Backup = lazy(() => import("@/pages/backup"));
const Accounting = lazy(() => import("@/pages/accounting"));
const Users = lazy(() => import("@/pages/users"));
const Laser = lazy(() => import("@/pages/laser"));

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
