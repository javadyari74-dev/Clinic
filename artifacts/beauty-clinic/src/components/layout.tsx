import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Users, 
  CalendarDays, 
  Scissors, 
  UserCircle, 
  CreditCard, 
  Percent, 
  Box, 
  BarChart3, 
  BellRing, 
  Database,
  HandCoins,
  Calculator,
  Menu,
  Home,
  LogOut,
  ShieldCheck,
  UserCog,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useState, useEffect } from "react";
import { GlobalSearch } from "./global-search";
import { useAuth, type Permission } from "@/hooks/use-auth";
import { prefetchRoute } from "@/lib/page-loaders";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  permission?: Permission;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { href: "/", label: "داشبورد", icon: LayoutDashboard, permission: "dashboard" },
  { href: "/patients", label: "مراجعین", icon: Users, permission: "patients" },
  { href: "/appointments", label: "نوبت‌ها", icon: CalendarDays, permission: "appointments" },
  { href: "/payments", label: "صندوق", icon: CreditCard, permission: "payments" },
  { href: "/services", label: "خدمات", icon: Scissors, permission: "services" },
  { href: "/laser", label: "لیزر", icon: Zap, permission: "laser" },
  { href: "/staff", label: "کارمندان", icon: UserCircle, permission: "staff" },
  { href: "/commissions", label: "کمیسیون", icon: HandCoins, permission: "commissions" },
  { href: "/commission-recipients", label: "گیرندگان کمیسیون", icon: Users, permission: "commissions" },
  { href: "/discounts", label: "تخفیفات", icon: Percent, permission: "discounts" },
  { href: "/inventory", label: "انبار", icon: Box, permission: "inventory" },
  { href: "/accounting", label: "حسابداری و سود/زیان", icon: Calculator, permission: "accounting" },
  { href: "/reports", label: "گزارشات", icon: BarChart3, permission: "reports" },
  { href: "/reminders", label: "یادآوری‌ها", icon: BellRing, permission: "reminders" },
  { href: "/backup", label: "پشتیبان‌گیری", icon: Database, permission: "backup" },
  { href: "/users", label: "مدیریت کاربران", icon: UserCog, adminOnly: true },
];

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { user, logout, hasPermission } = useAuth();

  useEffect(() => {
    setIsMobileOpen(false);
  }, [location]);

  const visibleItems = navItems.filter(item => {
    if (item.adminOnly) return user?.role === "admin";
    if (!item.permission) return true;
    return hasPermission(item.permission);
  });

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      <div className="p-6">
        <h1 className="text-xl font-bold text-sidebar-primary-foreground tracking-tight">مطب زیبایی دکتر یاری</h1>
      </div>
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onMouseEnter={() => prefetchRoute(item.href)}
              onFocus={() => prefetchRoute(item.href)}
              onTouchStart={() => prefetchRoute(item.href)}
            >
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 cursor-pointer",
                  isActive 
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm font-medium" 
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-sm">{item.label}</span>
              </div>
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-sidebar-border space-y-2">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground font-bold flex-shrink-0">
            {user?.role === "admin" ? <ShieldCheck className="h-4 w-4" /> : user?.role === "laser_operator" ? <Zap className="h-4 w-4" /> : <UserCircle className="h-4 w-4" />}
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-sm font-medium truncate">{user?.username}</span>
            <span className="text-xs text-sidebar-foreground/70">
              {user?.role === "admin" ? "مدیر کل" : user?.role === "laser_operator" ? "اپراتور لیزر" : "کارمند"}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent flex-shrink-0"
            onClick={logout}
            title="خروج"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background w-full" dir="rtl">
      <aside className="hidden md:block w-64 flex-shrink-0 border-l border-border z-10 shadow-sm">
        <SidebarContent />
      </aside>

      <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
        <SheetContent side="right" className="p-0 w-72 border-l-0 bg-sidebar text-sidebar-foreground" dir="rtl">
          <SidebarContent />
        </SheetContent>
      </Sheet>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <header className="flex items-center gap-3 h-14 px-4 border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-20">
          <Button variant="ghost" size="icon" className="md:hidden flex-shrink-0" onClick={() => setIsMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <GlobalSearch />
          </div>
          <Link href="/">
            <Button variant="ghost" size="icon" className="flex-shrink-0" title="داشبورد">
              <Home className="h-5 w-5" />
            </Button>
          </Link>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8 relative">
          <div className="mx-auto max-w-7xl h-full pb-20">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
