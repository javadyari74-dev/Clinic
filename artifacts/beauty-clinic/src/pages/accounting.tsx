import { useState } from "react";
import { PersianDatePicker } from "@/components/persian-date-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, Wallet, Plus, Trash2,
  BarChart3, Package, Users, Home, Zap, MoreHorizontal, PiggyBank,
} from "lucide-react";
import { formatCurrency, toPersianDigits, formatShamsiDate } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import {
  useAccountingSummary, useAccountingByService, useAccountingChart,
  useExpenses, useCreateExpense, useDeleteExpense,
  type Period,
} from "@/hooks/use-accounting";

const CATEGORIES: { value: string; label: string; icon: React.ReactNode; color: string }[] = [
  { value: "salary",       label: "حقوق و دستمزد",    icon: <Users className="h-4 w-4" />,       color: "bg-blue-100 text-blue-700" },
  { value: "rent",         label: "اجاره مطب",         icon: <Home className="h-4 w-4" />,        color: "bg-purple-100 text-purple-700" },
  { value: "utilities",    label: "قبض‌ها و برق",       icon: <Zap className="h-4 w-4" />,         color: "bg-yellow-100 text-yellow-700" },
  { value: "consumables",  label: "مواد مصرفی",        icon: <Package className="h-4 w-4" />,     color: "bg-orange-100 text-orange-700" },
  { value: "other",        label: "سایر هزینه‌ها",     icon: <MoreHorizontal className="h-4 w-4" />, color: "bg-gray-100 text-gray-700" },
];

const PERIOD_LABELS: Record<string, string> = {
  today: "امروز",
  month: "این ماه",
  year: "امسال",
  all:   "همه",
};

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
  const [period, setPeriod] = useState<Period>("month");
  const [chartPeriod, setChartPeriod] = useState<"month" | "year">("month");
  const [expOpen, setExpOpen] = useState(false);
  const [svcCostOpen, setSvcCostOpen] = useState(false);
  const [newCat, setNewCat] = useState("salary");
  const [newAmount, setNewAmount] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newDate, setNewDate] = useState(() => new Date().toISOString().split("T")[0]);

  const { data: summary } = useAccountingSummary(period);
  const { data: byService } = useAccountingByService(period);
  const { data: chart } = useAccountingChart(chartPeriod);
  const { data: expenses } = useExpenses();
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
      }
    );
  }

  const topService = byService?.[0];

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

  const chartFormatted = (chart ?? []).map(p => ({
    ...p,
    label: new Intl.DateTimeFormat("fa-IR", { calendar: "persian", month: "short", day: "numeric" }).format(new Date(p.date)),
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">حسابداری و سود و زیان</h1>
          <p className="text-muted-foreground mt-1">تحلیل مالی دقیق مطب — درآمد، هزینه، و سود خالص</p>
        </div>
        <div className="flex gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PERIOD_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button className="gap-2" onClick={() => setExpOpen(true)}>
            <Plus className="h-4 w-4" />
            ثبت هزینه
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <StatCard
          title={`درآمد کل — ${PERIOD_LABELS[period]}`}
          value={formatCurrency(summary?.revenue)}
          icon={<Wallet className="h-5 w-5 text-primary" />}
          colorClass="text-foreground"
        />
        <StatCard
          title={`هزینه خدمات — ${PERIOD_LABELS[period]}`}
          value={formatCurrency(summary?.serviceCosts)}
          sub="پزشک + مواد + سایر"
          icon={<Package className="h-5 w-5 text-purple-600" />}
          colorClass="text-purple-600"
          onClick={() => setSvcCostOpen(true)}
        />
        <StatCard
          title={`هزینه‌های ثابت — ${PERIOD_LABELS[period]}`}
          value={formatCurrency(summary?.expenses)}
          icon={<TrendingDown className="h-5 w-5 text-orange-600" />}
          colorClass="text-orange-600"
        />
        <StatCard
          title={`پورسانت پرداختی — ${PERIOD_LABELS[period]}`}
          value={formatCurrency(summary?.commissions)}
          icon={<Users className="h-5 w-5 text-blue-600" />}
          colorClass="text-blue-600"
        />
        <StatCard
          title={`سود خالص — ${PERIOD_LABELS[period]}`}
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
              <span className="text-xl text-muted-foreground mx-1">−</span>
              <span className="text-purple-600 font-bold">{formatCurrency(summary.serviceCosts)}</span>
              <span className="text-muted-foreground">هزینه خدمات</span>
              <span className="text-xl text-muted-foreground mx-1">−</span>
              <span className="text-orange-600 font-bold">{formatCurrency(summary.expenses)}</span>
              <span className="text-muted-foreground">هزینه‌های ثابت</span>
              <span className="text-xl text-muted-foreground mx-1">−</span>
              <span className="text-blue-600 font-bold">{formatCurrency(summary.commissions)}</span>
              <span className="text-muted-foreground">پورسانت</span>
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
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">نمودار درآمد و هزینه</CardTitle>
                <Select value={chartPeriod} onValueChange={(v) => setChartPeriod(v as "month" | "year")}>
                  <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">۳۰ روز گذشته</SelectItem>
                    <SelectItem value="year">۳۶۵ روز گذشته</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartFormatted} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontFamily: "Vazirmatn", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontFamily: "Vazirmatn", fontSize: 10 }} tickLine={false} axisLine={false}
                    tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} width={60} />
                  <Tooltip
                    formatter={(v: number, name: string) => [
                      formatCurrency(v),
                      name === "revenue" ? "درآمد" : name === "expenses" ? "هزینه" : "سود"
                    ]}
                    labelFormatter={(l) => l}
                    contentStyle={{ fontFamily: "Vazirmatn", textAlign: "right", direction: "rtl" }}
                  />
                  <Legend formatter={(v) => v === "revenue" ? "درآمد" : v === "expenses" ? "هزینه" : "سود خالص"} />
                  <Bar dataKey="revenue" fill="#be185d" radius={[3,3,0,0]} name="revenue" />
                  <Bar dataKey="expenses" fill="#f97316" radius={[3,3,0,0]} name="expenses" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">سود خالص روزانه</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartFormatted}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontFamily: "Vazirmatn", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontFamily: "Vazirmatn", fontSize: 10 }} tickLine={false} axisLine={false}
                    tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} width={60} />
                  <Tooltip
                    formatter={(v: number) => [formatCurrency(v), "سود"]}
                    contentStyle={{ fontFamily: "Vazirmatn", textAlign: "right", direction: "rtl" }}
                  />
                  <Line type="monotone" dataKey="profit" stroke="#16a34a" strokeWidth={2} dot={false}
                    activeDot={{ r: 5, fill: "#16a34a" }} name="profit" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Expenses by Category */}
          {summary && Object.keys(summary.expensesByCategory).length > 0 && (
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
                      <p className="text-sm text-muted-foreground">پرفروش‌ترین خدمت — {PERIOD_LABELS[period]}</p>
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
                      <TableRow key={svc.serviceId}>
                        <TableCell className="font-medium">{svc.serviceName}</TableCell>
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
                            onClick={() => deleteExpense.mutate(exp.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!expenses?.length && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
                          هزینه‌ای ثبت نشده — با دکمه «هزینه جدید» شروع کنید
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
              جزئیات هزینه خدمات — {PERIOD_LABELS[period]}
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
    </div>
  );
}
