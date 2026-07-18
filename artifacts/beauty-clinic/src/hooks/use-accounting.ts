import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const TOKEN_KEY = "clinic_auth_token";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface AccountingSummary {
  revenue: number;
  expenses: number;
  commissions: number;
  serviceCosts: number;
  totalCosts: number;
  netProfit: number;
  expensesByCategory: Record<string, number>;
}

export interface ServiceProfit {
  serviceId: number;
  serviceName: string;
  category: string | null;
  revenue: number;
  doctorFeePerUnit: number;
  materialCostPerUnit: number;
  otherCostPerUnit: number;
  doctorFeeTotal: number;
  materialCostTotal: number;
  otherCostTotal: number;
  totalServiceCost: number;
  commissions: number;
  completedCount: number;
  profit: number;
  profitMargin: number;
}

export interface ChartPoint {
  date: string;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface Expense {
  id: number;
  category: string;
  amount: number;
  description: string;
  date: number;
  serviceId: number | null;
  staffId: number | null;
  createdAt: number;
}

export interface CreateExpenseInput {
  category: string;
  amount: number;
  description: string;
  date: number;
  serviceId?: number;
  staffId?: number;
}

export type Period = "today" | "month" | "year" | "all";

export function useAccountingSummary(period: Period = "month") {
  return useQuery<AccountingSummary>({
    queryKey: ["accounting", "summary", period],
    queryFn: () => apiFetch(`/api/accounting/summary?period=${period}`),
  });
}

export function useAccountingByService(period: Period = "month") {
  return useQuery<ServiceProfit[]>({
    queryKey: ["accounting", "by-service", period],
    queryFn: () => apiFetch(`/api/accounting/by-service?period=${period}`),
  });
}

export function useAccountingChart(period: "month" | "year" = "month") {
  return useQuery<ChartPoint[]>({
    queryKey: ["accounting", "chart", period],
    queryFn: () => apiFetch(`/api/accounting/chart?period=${period}`),
  });
}

export function useExpenses(category?: string) {
  return useQuery<Expense[]>({
    queryKey: ["accounting", "expenses", category],
    queryFn: () => apiFetch(`/api/accounting/expenses${category ? `?category=${category}` : ""}`),
  });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateExpenseInput) =>
      apiFetch<Expense>("/api/accounting/expenses", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounting"] }),
  });
}

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<void>(`/api/accounting/expenses/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accounting"] }),
  });
}
