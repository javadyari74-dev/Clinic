import { useGetReportsSummary, useGetRevenueChart } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, toPersianDigits } from "@/lib/format";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { TrendingUp, Users, Calendar, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ErrorNotice } from "@/components/error-notice";

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
