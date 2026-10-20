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
  Bug,
  MessageSquare,
  Star,
  Gift,
  ShoppingCart,
  ChevronDown,
  Sparkles,
  History,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { formatShamsiDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useState, useEffect } from "react";
import { GlobalSearch } from "./global-search";
import { useAuth, type Permission, type AuthUser } from "@/hooks/use-auth";
import { prefetchRoute } from "@/lib/page-loaders";

export type NavGroup = "daily" | "finance" | "services" | "clients" | "admin";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  /** بخش منوی کناری؛ «daily» همیشه باز و بدون سرتیتر است */
  group: NavGroup;
  permission?: Permission;
  adminOnly?: boolean;
}

// ترتیب بخش‌های منو؛ کاربر می‌تواند هر بخش را باز/بسته کند (در همین مرورگر به خاطر سپرده می‌شود)
export const navGroups: { key: Exclude<NavGroup, "daily">; label: string }[] = [
  { key: "finance", label: "مالی و حسابداری" },
  { key: "services", label: "خدمات و انبار" },
  { key: "clients", label: "ارتباط با مراجعین" },
  { key: "admin", label: "مدیریت و تنظیمات" },
];

export function canAccessNavItem(
  item: Pick<NavItem, "permission" | "adminOnly">,
  role: AuthUser["role"] | undefined,
  hasPermission: (p: Permission) => boolean,
): boolean {
  if (item.adminOnly) return role === "admin";
  if (!item.permission) return true;
  return hasPermission(item.permission);
}

export const navItems: NavItem[] = [
  { href: "/", label: "داشبورد", icon: LayoutDashboard, group: "daily", permission: "dashboard" },
  { href: "/patients", label: "مراجعین", icon: Users, group: "daily", permission: "patients" },
  { href: "/appointments", label: "نوبت‌ها", icon: CalendarDays, group: "daily", permission: "appointments" },
  { href: "/payments", label: "صندوق", icon: CreditCard, group: "daily", permission: "payments" },
  { href: "/laser", label: "لیزر", icon: Zap, group: "daily", permission: "laser" },
  { href: "/accounting", label: "حسابداری و سود/زیان", icon: Calculator, group: "finance", permission: "accounting" },
  { href: "/purchases", label: "خریدها", icon: ShoppingCart, group: "finance", permission: "purchases" },
  { href: "/commissions", label: "کمیسیون", icon: HandCoins, group: "finance", permission: "commissions" },
  { href: "/commission-recipients", label: "گیرندگان کمیسیون", icon: Users, group: "finance", permission: "commissions" },
  { href: "/reports", label: "گزارشات", icon: BarChart3, group: "finance", permission: "reports" },
  { href: "/services", label: "خدمات", icon: Scissors, group: "services", permission: "services" },
  { href: "/discounts", label: "تخفیفات", icon: Percent, group: "services", permission: "discounts" },
  { href: "/inventory", label: "انبار", icon: Box, group: "services", permission: "inventory" },
  { href: "/reminders", label: "یادآوری‌ها", icon: BellRing, group: "clients", permission: "reminders" },
  { href: "/sms", label: "پنل پیامکی", icon: MessageSquare, group: "clients", permission: "sms" },
  { href: "/loyalty", label: "باشگاه مشتریان", icon: Gift, group: "clients", permission: "loyalty" },
  { href: "/surveys", label: "نظرسنجی‌ها", icon: Star, group: "clients", permission: "surveys" },
  { href: "/staff", label: "کارمندان", icon: UserCircle, group: "admin", permission: "staff" },
  { href: "/backup", label: "پشتیبان‌گیری", icon: Database, group: "admin", permission: "backup" },
  { href: "/users", label: "مدیریت کاربران", icon: UserCog, group: "admin", adminOnly: true },
  { href: "/client-errors", label: "گزارش‌های خطا", icon: Bug, group: "admin", adminOnly: true },
  { href: "/activity-log", label: "تاریخچهٔ تغییرات", icon: History, group: "admin", adminOnly: true },
];

const NAV_OPEN_KEY = "clinic_nav_open_groups";

function isActivePath(location: string, href: string): boolean {
  return location === href || (href !== "/" && location.startsWith(href));
}

function loadOpenGroups(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(NAV_OPEN_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

interface LastBackup { lastBackupAt: number | null; ok: boolean }

/** «۲۳ مهر ساعت ۱۰:۱۲» */
export function formatBackupTime(sec: number): string {
  const d = new Date(sec * 1000);
  const day = new Intl.DateTimeFormat("fa-IR", { calendar: "persian", month: "long", day: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${day} ساعت ${time}`;
}

// زمان آخرین بکاپ — فقط برای مدیر یا دارندهٔ دسترسی پشتیبان‌گیری (همان قاعدهٔ سرور)
function LastBackupLine({ enabled }: { enabled: boolean }) {
  const { data } = useQuery({
    queryKey: ["/api/backup/last"],
    queryFn: () => customFetch<LastBackup>("/api/backup/last"),
    enabled,
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
    retry: false,
  });
  if (!enabled || !data) return null;
  if (!data.ok || data.lastBackupAt == null) {
    return (
      <div
        className="px-3 text-[11px] font-medium text-amber-400"
        title={data.lastBackupAt ? `آخرین پشتیبان: ${formatBackupTime(data.lastBackupAt)}` : undefined}
      >
        {data.lastBackupAt ? `آخرین پشتیبان: ${formatBackupTime(data.lastBackupAt)} (قدیمی)` : "پشتیبان گرفته نشده"}
      </div>
    );
  }
  return (
    <div className="px-3 text-[11px] text-sidebar-foreground/50" title="آخرین پشتیبان خودکار">
      آخرین پشتیبان: {formatBackupTime(data.lastBackupAt)}
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { user, logout, hasPermission } = useAuth();

  useEffect(() => {
    setIsMobileOpen(false);
  }, [location]);

  const visibleItems = navItems.filter(item =>
    canAccessNavItem(item, user?.role, hasPermission),
  );
  const dailyItems = visibleItems.filter((i) => i.group === "daily");

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(loadOpenGroups);
  const toggleGroup = (key: string, open: boolean) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [key]: open };
      try { localStorage.setItem(NAV_OPEN_KEY, JSON.stringify(next)); } catch { /* ذخیره نشد؛ مهم نیست */ }
      return next;
    });
  };

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = isActivePath(location, item.href);
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
            "flex items-center gap-3 px-4 py-2 rounded-full transition-all duration-200 cursor-pointer",
            isActive
              ? "bg-white text-sidebar shadow-[0_6px_18px_-6px_rgba(0,0,0,0.35)] font-bold"
              : "text-sidebar-foreground/80 hover:bg-white/10 hover:text-sidebar-foreground"
          )}
        >
          <Icon className={cn("h-5 w-5", isActive && "text-sidebar-primary")} />
          <span className="text-sm">{item.label}</span>
        </div>
      </Link>
    );
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      <div className="px-6 pt-6 pb-3">
        <h1 className="flex items-center gap-2.5 text-lg font-extrabold text-sidebar-primary-foreground tracking-tight">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sidebar-primary shadow-[0_6px_16px_-6px_rgba(0,0,0,0.4)]">
            <Sparkles className="h-4 w-4" />
          </span>
          مطب زیبایی دکتر یاری
        </h1>
      </div>
      <nav className="flex-1 overflow-y-auto py-2 px-3 space-y-1">
        {dailyItems.map(renderItem)}
        {navGroups.map((g) => {
          const items = visibleItems.filter((i) => i.group === g.key);
          if (items.length === 0) return null;
          const hasActive = items.some((i) => isActivePath(location, i.href));
          // بخشی که صفحهٔ فعلی در آن است همیشه باز است
          const open = hasActive || (openGroups[g.key] ?? false);
          return (
            <div key={g.key} className="pt-2">
              <button
                type="button"
                onClick={() => toggleGroup(g.key, !open)}
                disabled={hasActive}
                aria-expanded={open}
                className="w-full flex items-center justify-between px-4 py-1.5 text-xs font-semibold text-sidebar-foreground/60 hover:text-sidebar-foreground disabled:cursor-default disabled:hover:text-sidebar-foreground/60"
              >
                <span>{g.label}</span>
                {!hasActive && (
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open ? "" : "rotate-90")} />
                )}
              </button>
              {open && <div className="space-y-1">{items.map(renderItem)}</div>}
            </div>
          );
        })}
      </nav>
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-3 px-3 py-2 rounded-full bg-black/20">
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
        <div className="px-3 text-[11px] text-sidebar-foreground/50" title="تاریخ ساخت این نسخهٔ برنامه">
          نسخهٔ {formatShamsiDate(typeof __BUILD_TIME__ === "number" ? __BUILD_TIME__ : 0, true)}
        </div>
        <LastBackupLine enabled={Boolean(user) && (user?.role === "admin" || hasPermission("backup"))} />
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background w-full" dir="rtl">
      <aside className="hidden md:block w-64 flex-shrink-0 z-10 shadow-[0_0_40px_-12px_rgba(127,29,29,0.45)]">
        <SidebarContent />
      </aside>

      <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
        <SheetContent side="right" className="p-0 w-72 border-l-0 bg-sidebar text-sidebar-foreground" dir="rtl">
          <SidebarContent />
        </SheetContent>
      </Sheet>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <header className="flex items-center gap-3 h-14 px-4 md:px-8 bg-background/80 backdrop-blur-sm sticky top-0 z-20">
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
