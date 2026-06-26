import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";

import Dashboard from "@/pages/dashboard";
import Patients from "@/pages/patients";
import PatientDetail from "@/pages/patient-detail";
import Appointments from "@/pages/appointments";
import Payments from "@/pages/payments";
import Services from "@/pages/services";
import Staff from "@/pages/staff";
import Commissions from "@/pages/commissions";
import CommissionRecipients from "@/pages/commission-recipients";
import Discounts from "@/pages/discounts";
import Inventory from "@/pages/inventory";
import Reports from "@/pages/reports";
import Reminders from "@/pages/reminders";
import Backup from "@/pages/backup";
import Accounting from "@/pages/accounting";
import Users from "@/pages/users";
import Laser from "@/pages/laser";

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
      <Switch>
        <Route path="/login" component={Login} />
        <Route component={RedirectToLogin} />
      </Switch>
    );
  }

  return (
    <Layout>
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
