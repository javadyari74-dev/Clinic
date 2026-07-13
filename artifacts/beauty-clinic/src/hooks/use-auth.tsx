import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";

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

function parseToken(token: string): AuthUser | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
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
