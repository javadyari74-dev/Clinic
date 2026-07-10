import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { toast } from "@/hooks/use-toast";

export type Permission =
  | "dashboard" | "patients" | "appointments" | "payments"
  | "services" | "laser" | "staff" | "commissions" | "discounts"
  | "inventory" | "accounting" | "reports" | "reminders" | "backup";

export interface AuthUser {
  id: number;
  username: string;
  role: "admin" | "staff" | "laser_operator";
  permissions: Permission[];
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hasPermission: (p: Permission) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "clinic_auth_token";

// رویدادی که وقتی نشست کاربر منقضی شده (توکن قدیمی/نامعتبر و پاسخ 401 از سرور)
// سراسری منتشر می‌شود تا AuthProvider کاربر را به صفحه ورود برگرداند.
export const SESSION_EXPIRED_EVENT = "clinic:session-expired";

// توکن را حذف، رویداد انقضای نشست را منتشر و یک پیام روشن به کاربر نشان می‌دهد.
// اگر توکنی وجود نداشته باشد (قبلاً خارج شده) کاری نمی‌کند و false برمی‌گرداند
// تا با چند درخواست هم‌زمانِ ناموفق، پیام تکراری نمایش داده نشود.
export function notifySessionExpired(): boolean {
  if (!localStorage.getItem(TOKEN_KEY)) return false;
  localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  toast({
    title: "نشست شما منقضی شده است",
    description: "برای ادامه کار لطفاً دوباره وارد شوید.",
    variant: "destructive",
  });
  return true;
}

// برای fetchهای دستی (خارج از کلاینت تولیدشده): اگر پاسخ 401 بود نشست را
// منقضی اعلام می‌کند تا کاربر به‌جای خطای عمومی، به صفحه ورود هدایت شود.
export function guardSession(res: Response): Response {
  if (res.status === 401) notifySessionExpired();
  return res;
}

function parseToken(token: string): AuthUser | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    // توکن منقضی‌شده مانند «بدون توکن» است؛ در غیر این صورت برنامه با توکن مرده
    // درخواست می‌فرستد و به‌جای صفحه ورود، خطای عمومی «مشکل سرور» نشان داده می‌شود.
    if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) {
      return null;
    }
    return {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      permissions: payload.permissions ?? [],
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    return t ? parseToken(t) : null;
  });
  const [isLoading, setIsLoading] = useState(false);

  // با انتشار رویداد انقضای نشست (مثلاً پاسخ 401 از سرور)، وضعیت ورود پاک می‌شود
  // تا گارد مسیرها کاربر را به صفحه ورود هدایت کند.
  useEffect(() => {
    const onExpired = () => {
      setToken(null);
      setUser(null);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => {
    if (token) {
      const parsed = parseToken(token);
      if (!parsed) {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      } else {
        setUser(parsed);
      }
    }
  }, [token]);

  const login = useCallback(async (username: string, password: string) => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "نام کاربری یا رمز عبور اشتباه است");
      }
      const { token: newToken } = await res.json();
      localStorage.setItem(TOKEN_KEY, newToken);
      setToken(newToken);
      setUser(parseToken(newToken));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const hasPermission = useCallback((p: Permission): boolean => {
    if (!user) return false;
    if (user.role === "admin") return true;
    if (user.role === "laser_operator") return p === "laser";
    return user.permissions.includes(p);
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
