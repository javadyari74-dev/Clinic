import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const TOKEN_KEY = "clinic_auth_token";

/**
 * خطای درخواست حسابداری؛ همان شکل ApiError کلاینت تولیدشده (status و data.error) تا
 * apiErrorMessage پیام سرور را نشان دهد و handleUnauthorized در App روی ۴۰۱ کاربر را به ورود ببرد.
 */
export class AccountingApiError extends Error {
  readonly status: number;
  readonly data: { error?: string; message?: string } | null;
  constructor(status: number, data: { error?: string; message?: string } | null, text: string) {
    super(data?.error ?? data?.message ?? (text || `HTTP ${status}`));
    this.name = "AccountingApiError";
    this.status = status;
    this.data = data;
  }
}

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
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let data: { error?: string; message?: string } | null = null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") data = parsed;
    } catch { /* پاسخ JSON نیست */ }
    throw new AccountingApiError(res.status, data, text);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface AccountingSummary {
  /** درآمد نقدی مطب (بدون لیزر) */
  revenue: number;
  /** درآمد لیزر (laser_payments) */
  laserRevenue: number;
  expenses: number;
  commissions: number;
  /** پورسانت اپراتور لیزر */
  laserCommissions: number;
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
  /** روز محلی، میلادی YYYY-MM-DD */
  date: string;
  revenue: number;
  serviceCosts: number;
  expenses: number;
  commissions: number;
  laserRevenue: number;
  laserCommissions: number;
  totalCosts: number;
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

/** بازهٔ گزارش به ثانیهٔ یونیکس؛ to انحصاری است (ابتدای روزِ بعد از آخرین روز). */
export interface DateRange {
  from: number;
  to: number;
}

const rangeQuery = (r: DateRange) => `from=${r.from}&to=${r.to}`;

export function useAccountingSummary(range: DateRange) {
  return useQuery<AccountingSummary>({
    queryKey: ["accounting", "summary", range.from, range.to],
    queryFn: () => apiFetch(`/api/accounting/summary?${rangeQuery(range)}`),
  });
}

/** بدهی‌ها/طلب‌های همین لحظه — خارج از سود و زیان */
export interface AccountingDebts {
  /** خریدهای تسویه‌نشده: بدهی مطب به فروشنده‌ها */
  suppliers: { total: number; count: number; bySupplier: { supplier: string | null; total: number; count: number }[] };
  /** مانده‌ی نوبت‌های تسویه‌شده: طلب مطب از مراجعین */
  patients: { total: number; count: number; patientCount: number };
}

export function useAccountingDebts() {
  return useQuery<AccountingDebts>({
    queryKey: ["accounting", "debts"],
    queryFn: () => apiFetch("/api/accounting/debts"),
  });
}

/** یک نوبت در ریز سود */
export interface ProfitVisit {
  appointmentId: number;
  patientId: number | null;
  patientName: string | null;
  /** روز خدمت (ثانیه) */
  serviceDate: number;
  /** شروع نسخهٔ قیمتی که هزینهٔ این نوبت از آن آمده (ثانیه؛ ۰ = از ابتدا) */
  versionFrom: number;
  /** هزینهٔ خدمت در همین بازه شمرده شده (اولین پرداخت غیربیعانه در بازه) */
  counted: boolean;
  revenue: number;
  doctorCost: number;
  materialCost: number;
  otherCost: number;
  serviceCost: number;
  commission: number;
  profit: number;
}

/** میانگین‌های هر دورهٔ قیمت یک خدمت */
export interface ProfitPeriod {
  versionFrom: number;
  firstDate: number;
  lastDate: number;
  count: number;
  avgRevenue: number;
  avgDoctorCost: number;
  avgMaterialCost: number;
  avgOtherCost: number;
  avgServiceCost: number;
  avgProfit: number;
}

export interface ServiceProfitDetail {
  serviceId: number;
  serviceName: string;
  category: string | null;
  count: number;
  revenue: number;
  doctorCost: number;
  materialCost: number;
  otherCost: number;
  serviceCost: number;
  commission: number;
  profit: number;
  profitMargin: number;
  periods: ProfitPeriod[];
  visits: ProfitVisit[];
}

export function useProfitDetails(range: DateRange, enabled: boolean) {
  return useQuery<{ from: number; to: number; services: ServiceProfitDetail[] }>({
    queryKey: ["accounting", "profit-details", range.from, range.to],
    queryFn: () => apiFetch(`/api/accounting/profit-details?${rangeQuery(range)}`),
    enabled,
  });
}

export function useAccountingByService(range: DateRange) {
  return useQuery<ServiceProfit[]>({
    queryKey: ["accounting", "by-service", range.from, range.to],
    queryFn: () => apiFetch(`/api/accounting/by-service?${rangeQuery(range)}`),
  });
}

export function useAccountingChart(range: DateRange) {
  // مرز روزها بر اساس منطقهٔ زمانی همین دستگاه (دقیقه، شرق UTC مثبت)
  const tz = -new Date().getTimezoneOffset();
  return useQuery<ChartPoint[]>({
    queryKey: ["accounting", "chart", range.from, range.to, tz],
    queryFn: () => apiFetch(`/api/accounting/chart?${rangeQuery(range)}&tz=${tz}`),
  });
}

export interface RevenueRange {
  revenue: number;
  from: number;
  to: number;
}

export function useRevenueRange(from: number | null, to: number | null) {
  return useQuery<RevenueRange>({
    queryKey: ["accounting", "revenue-range", from, to],
    queryFn: () => apiFetch(`/api/accounting/revenue-range?from=${from}&to=${to}`),
    enabled: from !== null && to !== null && from < to,
  });
}

export function useExpenses(range?: DateRange, category?: string) {
  const params = new URLSearchParams();
  if (range) {
    params.set("from", String(range.from));
    params.set("to", String(range.to));
    params.set("limit", "500");
  }
  if (category) params.set("category", category);
  const qs = params.toString();
  return useQuery<Expense[]>({
    queryKey: ["accounting", "expenses", range?.from, range?.to, category],
    queryFn: () => apiFetch(`/api/accounting/expenses${qs ? `?${qs}` : ""}`),
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

// ─── حداقل حاشیهٔ سود مطلوب (تنظیم محلی همین دستگاه؛ صفحهٔ خدمات و ریز سود) ─────────
export const MIN_MARGIN_KEY = "clinic_min_margin_pct";
export const DEFAULT_MIN_MARGIN = 20;

export function readMinMarginPct(): number {
  try {
    const raw = localStorage.getItem(MIN_MARGIN_KEY);
    if (raw === null || raw.trim() === "") return DEFAULT_MIN_MARGIN;
    const n = Number(raw);
    return Number.isFinite(n) ? n : DEFAULT_MIN_MARGIN;
  } catch {
    return DEFAULT_MIN_MARGIN;
  }
}

export function writeMinMarginPct(v: number): void {
  try {
    localStorage.setItem(MIN_MARGIN_KEY, String(v));
  } catch { /* ذخیره‌سازی در دسترس نیست */ }
}
