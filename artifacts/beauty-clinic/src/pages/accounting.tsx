import { useMemo, useState } from "react";
import { PersianDatePicker } from "@/components/persian-date-picker";
import { PersianDateRangePicker } from "@/components/persian-date-range-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ErrorNotice } from "@/components/error-notice";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  ComposedChart, Bar, Line, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import {
  TrendingUp, TrendingDown, Wallet, Plus, Trash2,
  BarChart3, Package, Users, Home, Zap, MoreHorizontal, PiggyBank,
} from "lucide-react";
import { formatCurrency, toPersianDigits, formatShamsiDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { apiErrorMessage } from "@/lib/api-error";
import {
  useAccountingSummary, useAccountingByService, useAccountingChart,
  useExpenses, useCreateExpense, useDeleteExpense,
  type DateRange, type ChartPoint, type Expense,
} from "@/hooks/use-accounting";
import {
  PRESET_LABELS, presetRange, formatRangeLabel, buildChartSeries, formatAxisAmount,
  type RangePreset,
} from "@/lib/shamsi-range";

const CATEGORIES: { value: string; label: string; icon: React.ReactNode; color: string }[] = [
  { value: "salary",       label: "حقوق و دستمزد",    icon: <Users className="h-4 w-4" />,       color: "bg-blue-100 text-blue-700" },
  { value: "rent",         label: "اجاره مطب",         icon: <Home className="h-4 w-4" />,        color: "bg-purple-100 text-purple-700" },
  { value: "utilities",    label: "قبض‌ها و برق",       icon: <Zap className="h-4 w-4" />,         color: "bg-yellow-100 text-yellow-700" },
  { value: "consumables",  label: "مواد مصرفی",        icon: <Package className="h-4 w-4" />,     color: "bg-orange-100 text-orange-700" },
  { value: "other",        label: "سایر هزینه‌ها",     icon: <MoreHorizontal className="h-4 w-4" />, color: "bg-gray-100 text-gray-700" },
];

const SERIES_LABELS: Record<string, string> = {
  revenue: "درآمد",
  serviceCosts: "هزینه خدمات",
  expenses: "هزینه‌های ثابت",
  commissions: "پورسانت",
  laserRevenue: "درآمد لیزر",
  laserCommissions: "پورسانت لیزر",
  profit: "سود / زیان",
  cumulativeProfit: "سود انباشته",
};

function localDateString(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function catLabel(v: string) {
  return CATEGORIES.find(c => c.value === v)?.label ?? v;
}
function catColor(v: string) {
  return CATEGORIES.find(c => c.value === v)?.color ?? "bg-gray-100 text-gray-700";
}

function StatCard({ title, value, sub, trend, icon, colorClass, onClick }: {
  title: string; value: string; sub?: string;
  trend?: "up" | "down" | "neutral"; icon: React.ReactNode; colorClass: string;
  onClick?: () => void;
}) {
  return (
    <Card
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={onClick ? "cursor-pointer transition hover:shadow-md hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" : undefined}
    >
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground mb-1">{title}</p>
            <p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
            {onClick && <p className="text-[11px] text-primary mt-1 font-medium">برای مشاهده جزئیات کلیک کنید ›</p>}
          </div>
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${colorClass.includes("green") ? "bg-green-100" : colorClass.includes("red") ? "bg-red-100" : "bg-primary/10"}`}>
            {icon}
          </div>
        </div>
        {trend && (
          <div className={`flex items-center gap-1 mt-2 text-xs ${trend === "up" ? "text-green-600" : trend === "down" ? "text-red-600" : "text-muted-foreground"}`}>
            {trend === "up" ? <TrendingUp className="h-3 w-3" /> : trend === "down" ? <TrendingDown className="h-3 w-3" /> : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Accounting() {
  const { toast } = useToast();
  const [preset, setPreset] = useState<RangePreset>("month");
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  const [expOpen, setExpOpen] = useState(false);
  const [svcCostOpen, setSvcCostOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Expense | null>(null);
  const [newCat, setNewCat] = useState("salary");
  const [newAmount, setNewAmount] = useState("");
  const [newDesc, setNewDesc] = useState("");
  // تاریخ محلی (نه UTC) تا بین ۰۰:۰۰ تا ۰۳:۳۰ بامداد، «دیروز» پیش‌فرض نشود
  const [newDate, setNewDate] = useState(() => localDateString());

  const range = useMemo<DateRange>(
    () => (preset === "custom" && customRange ? customRange : presetRange(preset === "custom" ? "month" : preset)),
    [preset, customRange],
  );
  const periodLabel = preset === "custom" ? "بازه انتخابی" : PRESET_LABELS[preset];
  const rangeLabel = formatRangeLabel(range);

  const { data: summary, isError: summaryError, refetch: refetchSummary } = useAccountingSummary(range);
  const { data: byService, isError: byServiceError, refetch: refetchByService } = useAccountingByService(range);
  const { data: chart, isError: chartError, refetch: refetchChart } = useAccountingChart(range);
  const { data: expenses, isError: expensesError, refetch: refetchExpenses } = useExpenses(range);
  const isError = summaryError || byServiceError || chartError || expensesError;
  const retry = () => { refetchSummary(); refetchByService(); refetchChart(); refetchExpenses(); };
  const createExpense = useCreateExpense();
  const deleteExpense = useDeleteExpense();

  function handleAddExpense() {
    if (!newAmount || !newDesc) {
      toast({ title: "مبلغ و توضیح الزامی است", variant: "destructive" });
      return;
    }
    const [y, m, d] = newDate.split("-").map(Number);
    const date = Math.floor(new Date(y, m - 1, d).getTime() / 1000);
    createExpense.mutate(
      { category: newCat, amount: Number(newAmount), description: newDesc, date },
      {
        onSuccess: () => {
          toast({ title: "هزینه ثبت شد" });
          setExpOpen(false);
          setNewAmount(""); setNewDesc("");
        },
        onError: (error) => {
          const serverMessage =
            (error as any)?.data?.error ?? (error as any)?.data?.message;
          toast({
            title: "ثبت هزینه ناموفق بود",
            description:
              typeof serverMessage === "string" && serverMessage.trim()
                ? serverMessage
                : "ثبت هزینه با خطا مواجه شد. لطفاً دوباره تلاش کنید.",
            variant: "destructive",
          });
        },
      }
    );
  }

  // ردیف‌های ساختگی («بدون نوبت / حذف‌شده»، «بدون خدمت») شناسهٔ منفی دارند و خدمت برتر نیستند
  const topService = byService?.find(s => s.serviceId > 0);

  const svcCostRows = (byService ?? [])
    .filter(s => s.totalServiceCost > 0)
    .sort((a, b) => b.totalServiceCost - a.totalServiceCost);
  const svcCostComponents = (byService ?? []).reduce(
    (acc, s) => {
      acc.doctor += s.doctorFeeTotal;
      acc.material += s.materialCostTotal;
      acc.other += s.otherCostTotal;
      return acc;
    },
    { doctor: 0, material: 0, other: 0 }
  );
  const svcCostTotal = svcCostComponents.doctor + svcCostComponents.material + svcCostComponents.other;

  // لیزر جدا از درآمد/پورسانت مطب گروه می‌شود (همان ستون‌های زمانی) تا در نمودار سری جدا داشته باشد؛
  // profit و totalCosts سرور از قبل لیزر را شامل می‌شوند.
  const { buckets: chartData, monthly: chartMonthly } = useMemo(() => {
    const points = chart ?? [];
    const main = buildChartSeries(points, range);
    const laserPoints: ChartPoint[] = points.map(p => ({
      date: p.date,
      revenue: p.laserRevenue ?? 0,
      commissions: p.laserCommissions ?? 0,
      serviceCosts: 0, expenses: 0, laserRevenue: 0, laserCommissions: 0,
      totalCosts: 0, profit: 0,
    }));
    const laserByKey = new Map(buildChartSeries(laserPoints, range).buckets.map(b => [b.key, b]));
    return {
      monthly: main.monthly,
      buckets: main.buckets.map(b => ({
        ...b,
        laserRevenue: laserByKey.get(b.key)?.revenue ?? 0,
        laserCommissions: laserByKey.get(b.key)?.commissions ?? 0,
      })),
    };
  }, [chart, range]);
  const chartHasData = chartData.some(b => b.revenue !== 0 || b.laserRevenue !== 0 || b.totalCosts !== 0);
  const hasLaser = !!summary && (summary.laserRevenue !== 0 || summary.laserCommissions !== 0);

  function confirmDeleteExpense() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    deleteExpense.mutate(id, {
      onSuccess: () => toast({ title: "هزینه حذف شد" }),
      onError: (error) => {
        toast({
          title: "حذف هزینه ناموفق بود",
          description: apiErrorMessage(error) ?? "حذف هزینه با خطا مواجه شد. لطفاً دوباره تلاش کنید.",
          variant: "destructive",
        });
      },
    });
  }
  const tooltipStyle = { fontFamily: "Vazirmatn", textAlign: "right" as const, direction: "rtl" as const };
  const axisTick = { fontFamily: "Vazirmatn", fontSize: 10 };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">حسابداری و سود و زیان</h1>
          <p className="text-muted-foreground mt-1">تحلیل مالی دقیق مطب — درآمد، هزینه، و سود خالص</p>
        </div>
        <Button className="gap-2" onClick={() => setExpOpen(true)}>
          <Plus className="h-4 w-4" />
          ثبت هزینه
        </Button>
      </div>

      {/* انتخاب بازهٔ زمانی (تقویم شمسی) */}
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(PRESET_LABELS) as Array<keyof typeof PRESET_LABELS>).map(k => (
          <Button
            key={k}
            size="sm"
            variant={preset === k ? "default" : "outline"}
            onClick={() => setPreset(k)}
          >
            {PRESET_LABELS[k]}
          </Button>
        ))}
        <PersianDateRangePicker
          value={preset === "custom" ? customRange : null}
          active={preset === "custom"}
          onChange={(r) => { setCustomRange(r); setPreset("custom"); }}
        />
        <span className="text-sm text-muted-foreground mr-auto">
          بازه: <span className="font-medium text-foreground">{rangeLabel}</span>
        </span>
      </div>

      {isError && <ErrorNotice onRetry={retry} />}

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          title={`درآمد مطب — ${periodLabel}`}
          value={formatCurrency(summary?.revenue)}
          sub="پرداخت‌های نقدی، بدون لیزر"
          icon={<Wallet className="h-5 w-5 text-primary" />}
          colorClass="text-foreground"
        />
        <StatCard
          title={`درآمد لیزر — ${periodLabel}`}
          value={formatCurrency(summary?.laserRevenue)}
          sub={summary ? `پورسانت لیزر: ${formatCurrency(summary.laserCommissions)}` : undefined}
          icon={<Zap className="h-5 w-5 text-teal-600" />}
          colorClass="text-teal-600"
        />
        <StatCard
          title={`هزینه خدمات — ${periodLabel}`}
          value={formatCurrency(summary?.serviceCosts)}
          sub="پزشک + مواد + سایر"
          icon={<Package className="h-5 w-5 text-purple-600" />}
          colorClass="text-purple-600"
          onClick={() => setSvcCostOpen(true)}
        />
        <StatCard
          title={`هزینه‌های ثابت — ${periodLabel}`}
          value={formatCurrency(summary?.expenses)}
          icon={<TrendingDown className="h-5 w-5 text-orange-600" />}
          colorClass="text-orange-600"
        />
        <StatCard
          title={`پورسانت پرداختی — ${periodLabel}`}
          value={formatCurrency(summary?.commissions)}
          icon={<Users className="h-5 w-5 text-blue-600" />}
          colorClass="text-blue-600"
        />
        <StatCard
          title={`سود خالص — ${periodLabel}`}
          value={formatCurrency(summary?.netProfit)}
          sub={summary ? `مجموع هزینه: ${formatCurrency(summary.totalCosts)}` : undefined}
          icon={<PiggyBank className="h-5 w-5 text-green-700" />}
          colorClass={(summary?.netProfit ?? 0) >= 0 ? "text-green-700" : "text-red-600"}
          trend={(summary?.netProfit ?? 0) >= 0 ? "up" : "down"}
        />
      </div>

      {/* فرمول سود */}
      {summary && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-center gap-2 text-sm font-mono justify-center">
              <span className="text-green-700 font-bold">{formatCurrency(summary.revenue)}</span>
              <span className="text-muted-foreground">درآمد</span>
              {hasLaser && (
                <>
                  <span className="text-xl text-muted-foreground mx-1">+</span>
                  <span className="text-teal-600 font-bold">{formatCurrency(summary.laserRevenue)}</span>
                  <span className="text-muted-foreground">درآمد لیزر</span>
                </>
              )}
              <span className="text-xl text-muted-foreground mx-1">−</span>
              <span className="text-purple-600 font-bold">{formatCurrency(summary.serviceCosts)}</span>
              <span className="text-muted-foreground">هزینه خدمات</span>
              <span className="text-xl text-muted-foreground mx-1">−</span>
              <span className="text-orange-600 font-bold">{formatCurrency(summary.expenses)}</span>
              <span className="text-muted-foreground">هزینه‌های ثابت</span>
              <span className="text-xl text-muted-foreground mx-1">−</span>
              <span className="text-blue-600 font-bold">{formatCurrency(summary.commissions)}</span>
              <span className="text-muted-foreground">پورسانت</span>
              {hasLaser && (
                <>
                  <span className="text-xl text-muted-foreground mx-1">−</span>
                  <span className="text-teal-700 font-bold">{formatCurrency(summary.laserCommissions)}</span>
                  <span className="text-muted-foreground">پورسانت لیزر</span>
                </>
              )}
              <span className="text-xl text-muted-foreground mx-1">=</span>
              <span className={`font-bold text-lg ${(summary.netProfit) >= 0 ? "text-green-700" : "text-red-600"}`}>
                {formatCurrency(summary.netProfit)} سود خالص
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="chart">
        <TabsList>
          <TabsTrigger value="chart" className="gap-2"><BarChart3 className="h-4 w-4" />نمودار</TabsTrigger>
          <TabsTrigger value="services" className="gap-2"><TrendingUp className="h-4 w-4" />سود هر خدمت</TabsTrigger>
          <TabsTrigger value="expenses" className="gap-2"><TrendingDown className="h-4 w-4" />هزینه‌ها</TabsTrigger>
        </TabsList>

        {/* ── Chart Tab ── */}
        <TabsContent value="chart" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                درآمد، هزینه‌ها و سود — {chartMonthly ? "ماهانه" : "روزانه"}
              </CardTitle>
              <p className="text-xs text-muted-foreground" dir="rtl">بازه: {rangeLabel}</p>
            </CardHeader>
            <CardContent>
              {chartHasData ? (
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={formatAxisAmount} width={60} />
                    <Tooltip
                      formatter={(v: number, name: string) => [formatCurrency(v), SERIES_LABELS[name] ?? name]}
                      contentStyle={tooltipStyle}
                    />
                    <Legend formatter={(v) => SERIES_LABELS[v] ?? v} wrapperStyle={{ fontFamily: "Vazirmatn", fontSize: 12 }} />
                    <ReferenceLine y={0} stroke="#9ca3af" />
                    <Bar dataKey="revenue" name="revenue" stackId="income" fill="#be185d" />
                    <Bar dataKey="laserRevenue" name="laserRevenue" stackId="income" fill="#0d9488" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="serviceCosts" name="serviceCosts" stackId="costs" fill="#9333ea" />
                    <Bar dataKey="expenses" name="expenses" stackId="costs" fill="#f97316" />
                    <Bar dataKey="commissions" name="commissions" stackId="costs" fill="#2563eb" />
                    <Bar dataKey="laserCommissions" name="laserCommissions" stackId="costs" fill="#5eead4" radius={[3, 3, 0, 0]} />
                    <Line type="linear" dataKey="profit" name="profit" stroke="#16a34a" strokeWidth={2}
                      dot={chartData.length <= 31} activeDot={{ r: 5, fill: "#16a34a" }} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">در این بازه درآمد یا هزینه‌ای ثبت نشده است</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                سود و زیان {chartMonthly ? "ماهانه" : "روزانه"}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                ستون سبز = سود، ستون قرمز = زیان؛ خط = سود انباشته از ابتدای بازه
              </p>
            </CardHeader>
            <CardContent>
              {chartHasData ? (
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={formatAxisAmount} width={60} />
                    <Tooltip
                      formatter={(v: number, name: string) => [formatCurrency(v), SERIES_LABELS[name] ?? name]}
                      contentStyle={tooltipStyle}
                    />
                    <ReferenceLine y={0} stroke="#9ca3af" />
                    <Bar dataKey="profit" name="profit" radius={[3, 3, 0, 0]}>
                      {chartData.map(b => (
                        <Cell key={b.key} fill={b.profit >= 0 ? "#16a34a" : "#dc2626"} />
                      ))}
                    </Bar>
                    <Line type="linear" dataKey="cumulativeProfit" name="cumulativeProfit" stroke="#0f766e"
                      strokeWidth={2} strokeDasharray="5 3" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">داده‌ای برای نمایش وجود ندارد</p>
              )}
            </CardContent>
          </Card>

          {/* Expenses by Category */}
          {summary?.expensesByCategory && Object.keys(summary.expensesByCategory).length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">هزینه به تفکیک دسته‌بندی</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(summary.expensesByCategory).sort((a,b)=>b[1]-a[1]).map(([cat, amt]) => {
                    const pct = summary.expenses > 0 ? Math.round((amt / summary.expenses) * 100) : 0;
                    return (
                      <div key={cat} className="flex items-center gap-3">
                        <Badge className={`${catColor(cat)} text-xs w-32 justify-center shrink-0`}>{catLabel(cat)}</Badge>
                        <div className="flex-1 bg-muted rounded-full h-2">
                          <div className="bg-primary h-2 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-sm font-medium w-28 text-left">{formatCurrency(amt)}</span>
                        <span className="text-xs text-muted-foreground w-8">{toPersianDigits(pct)}٪</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Services Tab ── */}
        <TabsContent value="services">
          <div className="space-y-4">
            {topService && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <TrendingUp className="h-6 w-6 text-primary" />
                    <div>
                      <p className="text-sm text-muted-foreground">پرفروش‌ترین خدمت — {periodLabel}</p>
                      <p className="font-bold text-lg">{topService.serviceName}</p>
                      <p className="text-sm text-muted-foreground">
                        درآمد: {formatCurrency(topService.revenue)} |
                        سود: {formatCurrency(topService.profit)} |
                        {toPersianDigits(topService.completedCount)} نوبت تکمیل شده
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="font-bold">خدمت</TableHead>
                      <TableHead className="font-bold text-left">نوبت</TableHead>
                      <TableHead className="font-bold text-left">درآمد</TableHead>
                      <TableHead className="font-bold text-left">هزینه خدمت</TableHead>
                      <TableHead className="font-bold text-left">پورسانت</TableHead>
                      <TableHead className="font-bold text-left">سود خالص</TableHead>
                      <TableHead className="font-bold text-left">حاشیه سود</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(byService ?? []).map(svc => (
                      <TableRow key={svc.serviceId} className={svc.serviceId < 0 ? "bg-muted/20 text-muted-foreground" : undefined}>
                        <TableCell className="font-medium">
                          {svc.serviceName}
                          {svc.serviceId < 0 && (
                            <span className="block text-[11px] font-normal">پرداخت/پورسانتی که به خدمتی وصل نیست</span>
                          )}
                        </TableCell>
                        <TableCell className="text-left font-mono">{toPersianDigits(svc.completedCount)}</TableCell>
                        <TableCell className="text-left font-mono text-green-700">{formatCurrency(svc.revenue)}</TableCell>
                        <TableCell className="text-left font-mono text-purple-600">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-bold">{formatCurrency(svc.totalServiceCost)}</span>
                            {svc.totalServiceCost > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {[
                                  svc.doctorFeeTotal > 0 ? `پزشک ${formatCurrency(svc.doctorFeeTotal)}` : null,
                                  svc.materialCostTotal > 0 ? `مواد ${formatCurrency(svc.materialCostTotal)}` : null,
                                  svc.otherCostTotal > 0 ? `سایر ${formatCurrency(svc.otherCostTotal)}` : null,
                                ].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-left font-mono text-blue-600">{formatCurrency(svc.commissions)}</TableCell>
                        <TableCell className={`text-left font-mono font-bold ${svc.profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                          {formatCurrency(svc.profit)}
                        </TableCell>
                        <TableCell className="text-left">
                          <Badge variant={svc.profitMargin >= 50 ? "default" : svc.profitMargin >= 20 ? "secondary" : "destructive"} className="text-xs">
                            {toPersianDigits(svc.profitMargin)}٪
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!byService?.length && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                          داده‌ای برای این بازه یافت نشد
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Expenses Tab ── */}
        <TabsContent value="expenses">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                ثبت هزینه‌های ثابت مثل اجاره، حقوق، قبض‌ها و مواد مصرفی
              </p>
              <Button size="sm" className="gap-2" onClick={() => setExpOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                هزینه جدید
              </Button>
            </div>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>دسته‌بندی</TableHead>
                      <TableHead>توضیح</TableHead>
                      <TableHead>تاریخ</TableHead>
                      <TableHead>مبلغ</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(expenses ?? []).map(exp => (
                      <TableRow key={exp.id}>
                        <TableCell>
                          <Badge className={`${catColor(exp.category)} text-xs`}>{catLabel(exp.category)}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{exp.description}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatShamsiDate(exp.date)}</TableCell>
                        <TableCell className="font-mono font-medium">{formatCurrency(exp.amount)}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost" size="sm"
                            className="text-destructive h-7 w-7 p-0"
                            aria-label="حذف هزینه"
                            disabled={deleteExpense.isPending}
                            onClick={() => setPendingDelete(exp)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!expenses?.length && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                          در این بازه هزینه‌ای ثبت نشده — با دکمه «هزینه جدید» شروع کنید
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Add Expense Dialog */}
      <Dialog open={expOpen} onOpenChange={setExpOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-orange-600" />
              ثبت هزینه جدید
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-sm mb-1.5 block">دسته‌بندی *</Label>
              <Select value={newCat} onValueChange={setNewCat}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">مبلغ (تومان) *</Label>
              <Input
                type="number"
                placeholder="مثلاً: 5000000"
                dir="ltr"
                value={newAmount}
                onChange={e => setNewAmount(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">توضیح *</Label>
              <Input
                placeholder="مثلاً: اجاره ماه تیر"
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-sm mb-1.5 block">تاریخ</Label>
              <PersianDatePicker value={newDate} onChange={setNewDate} placeholder="انتخاب تاریخ" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setExpOpen(false)}>انصراف</Button>
            <Button onClick={handleAddExpense} disabled={createExpense.isPending}>
              {createExpense.isPending ? "در حال ثبت..." : "ثبت هزینه"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Service Cost Breakdown Dialog */}
      <Dialog open={svcCostOpen} onOpenChange={setSvcCostOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-purple-600" />
              جزئیات هزینه خدمات — {periodLabel}
            </DialogTitle>
          </DialogHeader>

          {/* تفکیک بر اساس نوع هزینه */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">تفکیک بر اساس نوع هزینه</p>
            {[
              { key: "doctor", label: "حق‌الزحمه پزشک", amount: svcCostComponents.doctor, color: "bg-purple-500" },
              { key: "material", label: "مواد مصرفی", amount: svcCostComponents.material, color: "bg-pink-500" },
              { key: "other", label: "سایر هزینه‌ها", amount: svcCostComponents.other, color: "bg-amber-500" },
            ].filter(c => c.amount > 0).map(c => {
              const pct = svcCostTotal > 0 ? Math.round((c.amount / svcCostTotal) * 100) : 0;
              return (
                <div key={c.key} className="flex items-center gap-3">
                  <span className="text-sm w-32 shrink-0">{c.label}</span>
                  <div className="flex-1 bg-muted rounded-full h-2 min-w-0">
                    <div className={`${c.color} h-2 rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-sm font-bold w-28 text-left font-mono text-purple-600">{formatCurrency(c.amount)}</span>
                  <span className="text-xs text-muted-foreground w-8">{toPersianDigits(pct)}٪</span>
                </div>
              );
            })}
            <div className="flex items-center justify-between border-t pt-2 mt-1">
              <span className="text-sm font-bold">مجموع هزینه خدمات</span>
              <span className="text-base font-bold font-mono text-purple-700">{formatCurrency(svcCostTotal)}</span>
            </div>
          </div>

          <Separator />

          {/* تفکیک به ازای هر خدمت */}
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">تفکیک به ازای هر خدمت</p>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="font-bold">خدمت</TableHead>
                  <TableHead className="font-bold text-left">نوبت</TableHead>
                  <TableHead className="font-bold text-left">پزشک</TableHead>
                  <TableHead className="font-bold text-left">مواد</TableHead>
                  <TableHead className="font-bold text-left">سایر</TableHead>
                  <TableHead className="font-bold text-left">جمع</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {svcCostRows.map(s => (
                  <TableRow key={s.serviceId}>
                    <TableCell className="font-medium">{s.serviceName}</TableCell>
                    <TableCell className="text-left font-mono">{toPersianDigits(s.completedCount)}</TableCell>
                    <TableCell className="text-left font-mono text-xs">{formatCurrency(s.doctorFeeTotal)}</TableCell>
                    <TableCell className="text-left font-mono text-xs">{formatCurrency(s.materialCostTotal)}</TableCell>
                    <TableCell className="text-left font-mono text-xs">{formatCurrency(s.otherCostTotal)}</TableCell>
                    <TableCell className="text-left font-mono font-bold text-purple-600">{formatCurrency(s.totalServiceCost)}</TableCell>
                  </TableRow>
                ))}
                {svcCostRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      هزینه خدماتی برای این بازه ثبت نشده
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={pendingDelete !== null}
        title="حذف هزینه"
        description={pendingDelete
          ? `هزینهٔ «${pendingDelete.description}» به مبلغ ${formatCurrency(pendingDelete.amount)} حذف شود؟ این عمل قابل بازگشت نیست.`
          : undefined}
        onConfirm={confirmDeleteExpense}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
