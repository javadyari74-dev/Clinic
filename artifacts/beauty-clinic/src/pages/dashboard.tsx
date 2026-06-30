import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useGetDashboardSummary, useGetRevenueChart, useListReminders,
  useListActivity, useListAppointments, useListPayments,
  customFetch,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatShamsiDate, toPersianDigits } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Users, CalendarDays, Wallet, CheckCircle, Activity,
  Bell, ChevronLeft, ChevronRight, Calendar, Gift, Phone,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from "recharts";

// ─── Shamsi Calendar Helpers ─────────────────────────────────────────────────

function toMs(ts: number): number {
  // Auto-detect: if ts > 1e11 it's already milliseconds, otherwise it's seconds
  return ts > 1e11 ? ts : ts * 1000;
}

function getShamsiParts(date: Date): { year: number; month: number; day: number } {
  // Use "en-US" locale so numbers come out as Latin digits (not Persian ۱۲۳)
  const parts = new Intl.DateTimeFormat("en-US-u-ca-persian", {
    year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(date);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function shamsiToGregorian(year: number, month: number, day: number): Date {
  const ref = new Date();
  ref.setHours(12, 0, 0, 0);
  const r = getShamsiParts(ref);
  const approx = Math.round(
    (year - r.year) * 365.25 +
      ((month - 1) * 30.5 + day) -
      ((r.month - 1) * 30.5 + r.day),
  );
  const base = new Date(ref);
  base.setDate(base.getDate() + approx);
  for (let d = -8; d <= 8; d++) {
    const test = new Date(base);
    test.setDate(test.getDate() + d);
    const p = getShamsiParts(test);
    if (p.year === year && p.month === month && p.day === day) return test;
  }
  return base;
}

function getShamsiMonthDays(year: number, month: number): number {
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  const d1 = shamsiToGregorian(year, 1, 1);
  const d2 = shamsiToGregorian(year + 1, 1, 1);
  return Math.round((d2.getTime() - d1.getTime()) / 86400000) === 366 ? 30 : 29;
}

function isSameShamsiDay(
  unixTs: number,
  year: number, month: number, day: number,
): boolean {
  const p = getShamsiParts(new Date(toMs(unixTs)));
  return p.year === year && p.month === month && p.day === day;
}

const SHAMSI_MONTHS = [
  "فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور",
  "مهر","آبان","آذر","دی","بهمن","اسفند",
];
const WEEK_DAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  scheduled:  { label: "رزرو شده",    color: "bg-blue-500" },
  completed:  { label: "تکمیل شده",   color: "bg-green-500" },
  cancelled:  { label: "لغو شده",     color: "bg-red-500" },
  no_show:    { label: "غیبت",         color: "bg-orange-500" },
};

const METHOD_MAP: Record<string, string> = {
  cash:     "نقدی",
  card:     "کارت",
  transfer: "انتقال",
  online:   "آنلاین",
};

// ─── Birthday Types & Hook ────────────────────────────────────────────────────

interface BirthdayAlert {
  patientId: number;
  name: string;
  phone: string;
  birthdate: string;
  birthdayShamsiYear: number;
  birthdayShamsiMonth: number;
  birthdayShamsiDay: number;
  daysUntil: number;
}

function useUpcomingBirthdays(days = 10) {
  return useQuery<BirthdayAlert[]>({
    queryKey: ["upcoming-birthdays", days],
    queryFn: () => customFetch<BirthdayAlert[]>(`/api/patients/upcoming-birthdays?days=${days}`),
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const todayRef = new Date();
  todayRef.setHours(12, 0, 0, 0);
  const todayShamsi = getShamsiParts(todayRef);

  const [calYear,  setCalYear]  = useState(todayShamsi.year);
  const [calMonth, setCalMonth] = useState(todayShamsi.month);
  const [selectedDay, setSelectedDay] = useState<{
    year: number; month: number; day: number;
  } | null>(todayShamsi);

  const { data: summary }          = useGetDashboardSummary();
  const { data: chartData }        = useGetRevenueChart();
  const { data: reminders }        = useListReminders({ status: "pending" });
  const { data: activities }       = useListActivity({ limit: 10 });
  const { data: allAppointments }  = useListAppointments();
  const { data: allPayments }      = useListPayments();
  const { data: birthdays = [] }   = useUpcomingBirthdays(10);

  // ── Calendar grid ──────────────────────────────────────────────────────────
  const { grid } = useMemo(() => {
    const firstGreg = shamsiToGregorian(calYear, calMonth, 1);
    const dow = firstGreg.getDay(); // 0=Sun … 6=Sat
    const firstDow = (dow + 1) % 7;  // Sat=0 … Fri=6
    const totalDays = getShamsiMonthDays(calYear, calMonth);
    const g: (number | null)[] = [];
    for (let i = 0; i < firstDow; i++) g.push(null);
    for (let d = 1; d <= totalDays; d++) g.push(d);
    while (g.length % 7 !== 0) g.push(null);
    return { grid: g };
  }, [calYear, calMonth]);

  // ── Event-indicator sets ────────────────────────────────────────────────────
  const apptDays = useMemo(() => {
    const s = new Set<number>();
    allAppointments?.data?.forEach((a) => {
      const p = getShamsiParts(new Date(toMs(a.scheduledAt)));
      if (p.year === calYear && p.month === calMonth) s.add(p.day);
    });
    return s;
  }, [allAppointments, calYear, calMonth]);

  const reminderDays = useMemo(() => {
    const s = new Set<number>();
    reminders?.forEach((r) => {
      if (!r.dueAt) return;
      const p = getShamsiParts(new Date(toMs(Number(r.dueAt))));
      if (p.year === calYear && p.month === calMonth) s.add(p.day);
    });
    return s;
  }, [reminders, calYear, calMonth]);

  const paymentDays = useMemo(() => {
    const s = new Set<number>();
    allPayments?.forEach((p) => {
      const parts = getShamsiParts(new Date(toMs(p.paidAt)));
      if (parts.year === calYear && parts.month === calMonth) s.add(parts.day);
    });
    return s;
  }, [allPayments, calYear, calMonth]);

  // ── Selected-day data ───────────────────────────────────────────────────────
  const selectedAppointments = useMemo(() => {
    if (!selectedDay) return [];
    return (allAppointments?.data ?? []).filter((a) =>
      isSameShamsiDay(a.scheduledAt, selectedDay.year, selectedDay.month, selectedDay.day),
    );
  }, [allAppointments, selectedDay]);

  const selectedReminders = useMemo(() => {
    if (!selectedDay) return [];
    return (reminders ?? []).filter(
      (r) =>
        r.dueAt &&
        isSameShamsiDay(Number(r.dueAt), selectedDay.year, selectedDay.month, selectedDay.day),
    );
  }, [reminders, selectedDay]);

  const selectedPayments = useMemo(() => {
    if (!selectedDay) return [];
    return (allPayments ?? []).filter((p) =>
      isSameShamsiDay(p.paidAt, selectedDay.year, selectedDay.month, selectedDay.day),
    );
  }, [allPayments, selectedDay]);

  // ── Navigation ──────────────────────────────────────────────────────────────
  function prevMonth() {
    if (calMonth === 1) { setCalYear((y) => y - 1); setCalMonth(12); }
    else setCalMonth((m) => m - 1);
  }
  function nextMonth() {
    if (calMonth === 12) { setCalYear((y) => y + 1); setCalMonth(1); }
    else setCalMonth((m) => m + 1);
  }

  const isToday    = (d: number) =>
    d === todayShamsi.day && calMonth === todayShamsi.month && calYear === todayShamsi.year;
  const isSelected = (d: number) =>
    selectedDay?.day === d && selectedDay?.month === calMonth && selectedDay?.year === calYear;

  const selectedDayLabel = selectedDay
    ? `${toPersianDigits(selectedDay.day)} ${SHAMSI_MONTHS[selectedDay.month - 1]} ${toPersianDigits(selectedDay.year)}`
    : "";

  const totalSelectedEvents =
    selectedAppointments.length + selectedReminders.length + selectedPayments.length;

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">داشبورد</h1>
        <p className="text-muted-foreground mt-1">خلاصه وضعیت مطب در یک نگاه</p>
      </div>

      {/* ── Stats ── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">درآمد این ماه</CardTitle>
            <Wallet className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summary?.monthlyRevenue)}</div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">نوبت‌های امروز</CardTitle>
            <CalendarDays className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.appointmentsToday || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {summary?.pendingAppointments || 0} در انتظار
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">کل مراجعین</CardTitle>
            <Users className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.totalPatients || 0}</div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">نوبت‌های تکمیل شده</CardTitle>
            <CheckCircle className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary?.completedThisMonth || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">در ماه جاری</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Birthday Alerts ── */}
      {birthdays.length > 0 && (
        <Card className="shadow-sm border-pink-200 dark:border-pink-900 bg-gradient-to-l from-pink-50/60 to-rose-50/60 dark:from-pink-950/30 dark:to-rose-950/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Gift className="h-5 w-5 text-pink-500" />
              تولدهای نزدیک
              <Badge className="mr-auto bg-pink-500 hover:bg-pink-600 text-white">
                {toPersianDigits(birthdays.length)} مراجع
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {birthdays.map((b) => {
                const isToday = b.daysUntil === 0;
                const isTomorrow = b.daysUntil === 1;
                return (
                  <div
                    key={b.patientId}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-xl border bg-card shadow-sm",
                      isToday && "border-pink-400 ring-2 ring-pink-300 dark:ring-pink-700",
                    )}
                  >
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center text-lg flex-shrink-0",
                      isToday ? "bg-pink-500 text-white" : "bg-pink-100 dark:bg-pink-900/50",
                    )}>
                      🎂
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{b.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {toPersianDigits(b.birthdayShamsiDay)}{" "}
                        {SHAMSI_MONTHS[b.birthdayShamsiMonth - 1]}
                      </p>
                      <p className={cn(
                        "text-xs font-medium mt-0.5",
                        isToday ? "text-pink-600 dark:text-pink-400" :
                        isTomorrow ? "text-orange-500" : "text-muted-foreground",
                      )}>
                        {isToday
                          ? "🎉 امروز تولدشه!"
                          : isTomorrow
                          ? "فردا تولدشه"
                          : `${toPersianDigits(b.daysUntil)} روز دیگه`}
                      </p>
                    </div>
                    <a
                      href={`tel:${b.phone}`}
                      title={`تماس با ${b.name}`}
                      className="text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
                    >
                      <Phone className="h-4 w-4" />
                    </a>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
              <Bell className="h-3 w-3" />
              یادتون باشه برای تولد مراجعین تبریک بگید یا تخفیف ویژه در نظر بگیرید
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Calendar + Day Events ── */}
      <div className="grid gap-4 lg:grid-cols-2">

        {/* Calendar */}
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between" dir="ltr">
              <Button variant="ghost" size="icon" onClick={prevMonth} aria-label="ماه قبل">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <CardTitle className="text-base" dir="rtl">
                {SHAMSI_MONTHS[calMonth - 1]}{" "}
                <span dir="ltr" className="inline-block">{toPersianDigits(calYear)}</span>
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={nextMonth} aria-label="ماه بعد">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>

          <CardContent>
            {/* Week-day headers */}
            <div className="grid grid-cols-7 mb-1">
              {WEEK_DAYS.map((wd) => (
                <div
                  key={wd}
                  className="text-center text-xs font-semibold text-muted-foreground py-1"
                >
                  {wd}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7 gap-0.5">
              {grid.map((day, i) => (
                <div key={i} className="aspect-square p-0.5">
                  {day !== null && (
                    <button
                      onClick={() =>
                        setSelectedDay({ year: calYear, month: calMonth, day })
                      }
                      className={cn(
                        "w-full h-full flex flex-col items-center justify-center rounded-lg text-sm transition-colors relative",
                        "hover:bg-accent",
                        isSelected(day) &&
                          "bg-primary text-primary-foreground hover:bg-primary/90",
                        isToday(day) &&
                          !isSelected(day) &&
                          "bg-accent font-bold ring-2 ring-primary/30",
                        !isSelected(day) && !isToday(day) && "text-foreground",
                      )}
                    >
                      <span className="text-xs leading-none">
                        {toPersianDigits(day)}
                      </span>
                      {/* Event dots */}
                      {(apptDays.has(day) || reminderDays.has(day) || paymentDays.has(day)) && (
                        <div className="flex gap-[3px] mt-1">
                          {apptDays.has(day) && (
                            <span
                              className={cn(
                                "w-1 h-1 rounded-full",
                                isSelected(day) ? "bg-primary-foreground/70" : "bg-blue-500",
                              )}
                            />
                          )}
                          {reminderDays.has(day) && (
                            <span
                              className={cn(
                                "w-1 h-1 rounded-full",
                                isSelected(day) ? "bg-primary-foreground/70" : "bg-amber-500",
                              )}
                            />
                          )}
                          {paymentDays.has(day) && (
                            <span
                              className={cn(
                                "w-1 h-1 rounded-full",
                                isSelected(day) ? "bg-primary-foreground/70" : "bg-green-500",
                              )}
                            />
                          )}
                        </div>
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="flex gap-5 mt-4 text-xs text-muted-foreground justify-center">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                نوبت
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                یادآوری
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                پرداخت
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Day Events Panel */}
        <Card className="shadow-sm flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary flex-shrink-0" />
              {selectedDay ? (
                <span>
                  رویدادهای {selectedDayLabel}
                </span>
              ) : (
                <span className="text-muted-foreground font-normal text-sm">
                  یک روز انتخاب کنید
                </span>
              )}
              {selectedDay && totalSelectedEvents > 0 && (
                <Badge variant="secondary" className="mr-auto">
                  {toPersianDigits(totalSelectedEvents)}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>

          <CardContent className="flex-1 overflow-y-auto space-y-4 max-h-[340px]">
            {!selectedDay ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                <Calendar className="h-10 w-10 opacity-20" />
                <p className="text-sm">برای مشاهده رویدادها روی یک روز کلیک کنید</p>
              </div>
            ) : totalSelectedEvents === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                <Calendar className="h-10 w-10 opacity-20" />
                <p className="text-sm">رویدادی برای این روز ثبت نشده</p>
              </div>
            ) : (
              <>
                {/* Appointments */}
                {selectedAppointments.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
                      نوبت‌ها
                      <span className="text-primary font-bold">
                        ({toPersianDigits(selectedAppointments.length)})
                      </span>
                    </p>
                    <div className="space-y-2">
                      {selectedAppointments.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center gap-2 p-2.5 rounded-lg border bg-card text-sm"
                        >
                          <span
                            className={cn(
                              "w-2 h-2 rounded-full flex-shrink-0",
                              STATUS_MAP[a.status]?.color ?? "bg-gray-400",
                            )}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{a.patientName}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {a.serviceName}
                              {a.staffName ? ` · ${a.staffName}` : ""}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono mt-0.5" dir="ltr">
                              {new Intl.DateTimeFormat("fa-IR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              }).format(new Date(toMs(a.scheduledAt)))}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-xs shrink-0">
                            {STATUS_MAP[a.status]?.label ?? a.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reminders */}
                {selectedReminders.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                      یادآوری‌ها
                      <span className="text-primary font-bold">
                        ({toPersianDigits(selectedReminders.length)})
                      </span>
                    </p>
                    <div className="space-y-2">
                      {selectedReminders.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center gap-2 p-2.5 rounded-lg border bg-card text-sm"
                        >
                          <Bell className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{r.title}</p>
                            {r.patientName && (
                              <p className="text-xs text-muted-foreground">
                                مراجع: {r.patientName}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Payments */}
                {selectedPayments.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                      پرداخت‌ها
                      <span className="text-primary font-bold">
                        ({toPersianDigits(selectedPayments.length)})
                      </span>
                    </p>
                    <div className="space-y-2">
                      {selectedPayments.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center gap-2 p-2.5 rounded-lg border bg-card text-sm"
                        >
                          <Wallet className="h-3.5 w-3.5 text-green-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{formatCurrency(p.amount)}</p>
                            {p.originalAmount !== p.amount && (
                              <p className="text-xs text-muted-foreground line-through">
                                {formatCurrency(p.originalAmount)}
                              </p>
                            )}
                          </div>
                          <Badge variant="outline" className="text-xs shrink-0">
                            {METHOD_MAP[p.method] ?? p.method}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Chart + Reminders & Activity ── */}
      <div className="grid gap-4 md:grid-cols-7">

        {/* Revenue Chart */}
        <Card className="md:col-span-4 shadow-sm">
          <CardHeader>
            <CardTitle>نمودار درآمد (۳۰ روز گذشته)</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px] w-full">
            {chartData && chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) =>
                      new Intl.DateTimeFormat("fa-IR", {
                        day: "numeric", month: "short",
                      }).format(new Date(v))
                    }
                    stroke="#888888"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#888888"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) =>
                      `${(v / 1000000).toLocaleString("fa-IR")}M`
                    }
                    width={80}
                  />
                  <RechartsTooltip
                    formatter={(v: number) => [formatCurrency(v), "درآمد"]}
                    labelFormatter={(l) =>
                      new Intl.DateTimeFormat("fa-IR", { dateStyle: "full" }).format(
                        new Date(l),
                      )
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 6, fill: "hsl(var(--primary))" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                داده‌ای برای نمایش وجود ندارد
              </div>
            )}
          </CardContent>
        </Card>

        <div className="md:col-span-3 space-y-4">
          {/* Active Reminders */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-amber-500" />
                <CardTitle className="text-base">یادآوری‌های فعال</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {reminders && reminders.length > 0 ? (
                  reminders.slice(0, 5).map((r) => (
                    <div
                      key={r.id}
                      className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card"
                    >
                      <div className="w-2 h-2 mt-2 rounded-full bg-amber-500 flex-shrink-0" />
                      <div className="flex-1 space-y-0.5">
                        <p className="text-sm font-medium">{r.title}</p>
                        {r.patientName && (
                          <p className="text-xs text-muted-foreground">
                            مراجع: {r.patientName}
                          </p>
                        )}
                        <p className="text-xs font-mono text-muted-foreground">
                          {formatShamsiDate(r.dueAt)}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    یادآوری فعالی وجود ندارد
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Activity Feed */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-blue-500" />
                <CardTitle className="text-base">آخرین فعالیت‌ها</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {activities && activities.length > 0 ? (
                  activities.slice(0, 5).map((a) => (
                    <div
                      key={a.id}
                      className="flex flex-col gap-1 pb-3 border-b border-border last:border-0 last:pb-0"
                    >
                      <p className="text-sm">{a.description}</p>
                      <span className="text-xs text-muted-foreground" dir="ltr">
                        {formatShamsiDate(a.createdAt, true)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    فعالیتی ثبت نشده است
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
