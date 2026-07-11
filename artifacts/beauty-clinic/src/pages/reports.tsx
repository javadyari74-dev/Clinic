import { useState } from "react";
import { useGetReportsSummary, useGetRevenueChart, useGetSurveyStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, toPersianDigits } from "@/lib/format";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { TrendingUp, Users, Calendar, AlertTriangle, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";
import { PersianDatePicker } from "@/components/persian-date-picker";
import { cn } from "@/lib/utils";

// تبدیل تاریخ میلادی "YYYY-MM-DD" (خروجی PersianDatePicker) به یونیکس ثانیه
// مرز شروع/پایان روز به وقت محلی
function dateToUnixSeconds(value: string, endOfDay: boolean): number | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const date = endOfDay ? new Date(y, m - 1, d, 23, 59, 59) : new Date(y, m - 1, d, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

function StatGroupList({ title, groups }: { title: string; groups: { id?: number | null; name?: string | null; count: number; avgScore: number }[] }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">داده‌ای موجود نیست</p>
      ) : (
        groups.map((g, idx) => (
          <div key={`${g.id ?? "null"}-${idx}`} className="flex items-center justify-between gap-3">
            <span className="text-sm truncate">{g.name ?? "نامشخص"}</span>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="secondary">{toPersianDigits(g.count)} نظر</Badge>
              <span className="flex items-center gap-1 text-sm font-medium">
                {toPersianDigits(g.avgScore.toFixed(1))}
                <Star className="size-3.5 fill-amber-400 text-amber-400" />
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// گزارش رضایت مراجعین از نظرسنجی‌های امتیازدار — با فیلتر بازه تاریخ شمسی
function SatisfactionSection() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const from = dateToUnixSeconds(fromDate, false);
  const to = dateToUnixSeconds(toDate, true);
  const params = {
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
  };
  const { data: stats, isError, refetch } = useGetSurveyStats(params);

  const hasFilter = fromDate !== "" || toDate !== "";

  return (
    <Card>
      <CardHeader className="space-y-4">
        <CardTitle className="flex items-center gap-2">
          <Star className="h-5 w-5 text-amber-500" />
          رضایت مراجعین (نظرسنجی)
        </CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">از تاریخ</span>
            <PersianDatePicker value={fromDate} onChange={setFromDate} placeholder="ابتدای بازه" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">تا تاریخ</span>
            <PersianDatePicker value={toDate} onChange={setToDate} placeholder="انتهای بازه" />
          </div>
          {hasFilter && (
            <Button variant="ghost" size="sm" onClick={() => { setFromDate(""); setToDate(""); }} data-testid="button-clear-survey-range">
              حذف فیلتر
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isError ? (
          <ErrorNotice onRetry={() => refetch()} />
        ) : !stats ? (
          <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border p-4">
                <div className="text-sm text-muted-foreground">نظرسنجی ارسال‌شده</div>
                <div className="mt-1 text-2xl font-bold">{toPersianDigits(stats.total)}</div>
              </div>
              <div className="rounded-xl border p-4">
                <div className="text-sm text-muted-foreground">امتیاز ثبت‌شده</div>
                <div className="mt-1 text-2xl font-bold">{toPersianDigits(stats.scoredCount)}</div>
              </div>
              <div className="rounded-xl border p-4">
                <div className="text-sm text-muted-foreground">میانگین رضایت</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className={cn("text-2xl font-bold", stats.avgScore != null && stats.avgScore < 3 ? "text-destructive" : "text-green-700")}>
                    {stats.avgScore != null ? toPersianDigits(stats.avgScore.toFixed(1)) : "—"}
                  </span>
                  {stats.avgScore != null && <Star className="size-5 fill-amber-400 text-amber-400" />}
                  <span className="text-sm text-muted-foreground">از ۵</span>
                </div>
              </div>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <StatGroupList title="به تفکیک خدمت" groups={stats.byService} />
              <StatGroupList title="به تفکیک کارمند" groups={stats.byStaff} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const statusLabels: Record<string, string> = {
  scheduled: "رزرو شده",
  confirmed: "تایید شده",
  arrived: "حاضر شده",
  in_progress: "در حال انجام",
  completed: "تکمیل شده",
  cancelled: "لغو شده",
  no_show: "غیبت",
};

export default function Reports() {
  const { data: summary, isError: summaryError, refetch: refetchSummary } = useGetReportsSummary();
  const { data: chartData, isError: chartError, refetch: refetchChart } = useGetRevenueChart();
  const isError = summaryError || chartError;
  const retry = () => { refetchSummary(); refetchChart(); };

  const chartFormatted = chartData?.map(d => ({
    date: d.date,
    revenue: d.revenue,
    label: new Intl.DateTimeFormat("fa-IR", { calendar: "persian", month: "short", day: "numeric" }).format(new Date(d.date)),
  })) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">گزارشات</h1>
        <p className="text-muted-foreground mt-1">تحلیل جامع عملکرد مطب</p>
      </div>

      {isError && <ErrorNotice onRetry={retry} />}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> کل درآمد
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-700">{formatCurrency(summary?.totalRevenue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" /> کل مراجعین
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{toPersianDigits(summary?.totalPatients ?? 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4" /> کل نوبت‌ها
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{toPersianDigits(summary?.totalAppointments ?? 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">کمیسیون پرداخت‌نشده</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{formatCurrency(summary?.totalUnpaidCommissions)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>نمودار درآمد (۳۰ روز گذشته)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartFormatted}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontFamily: "Vazirmatn", fontSize: 11 }} />
                <YAxis tick={{ fontFamily: "Vazirmatn", fontSize: 10 }} tickFormatter={(v) => `${(v / 1000000).toFixed(1)}M`} />
                <Tooltip
                  formatter={(v: number) => [formatCurrency(v), "درآمد"]}
                  labelFormatter={(l) => l}
                  contentStyle={{ fontFamily: "Vazirmatn", textAlign: "right" }}
                />
                <Bar dataKey="revenue" fill="#be185d" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>وضعیت نوبت‌ها</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {summary?.appointmentsByStatus?.length ? (
                summary.appointmentsByStatus.map((s) => (
                  <div key={s.status} className="flex items-center justify-between">
                    <span className="text-sm">{statusLabels[s.status] ?? s.status}</span>
                    <Badge variant="secondary">{toPersianDigits(s.count)} نوبت</Badge>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">داده‌ای موجود نیست</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <SatisfactionSection />

      {summary?.lowStockItems && summary.lowStockItems.length > 0 && (
        <Card className="border-orange-200">
          <CardHeader>
            <CardTitle className="text-orange-700 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              آیتم‌های کم‌موجودی
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {summary.lowStockItems.map((i: any) => (
                <Badge key={i.id} variant="outline" className="border-orange-300 text-orange-700">
                  {i.name} — {toPersianDigits(i.quantity)} {i.unit}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
