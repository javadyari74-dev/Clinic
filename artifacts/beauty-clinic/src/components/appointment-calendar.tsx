import { useMemo, useState } from "react";
import { DateObject } from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronLeft, AlertTriangle, Plus } from "lucide-react";
import { toPersianDigits } from "@/lib/format";
import { cn } from "@/lib/utils";

// ─── انواع ────────────────────────────────────────────────────────────────────

export type CalendarAppointment = {
  id: number;
  scheduledAt: number; // میلی‌ثانیه (نرمال‌شده)
  patientName?: string | null;
  serviceName?: string | null;
  status: string;
  staffName?: string | null;
};

type StatusMeta = Record<string, { label: string; color: string }>;

type Props = {
  appointments: CalendarAppointment[];
  statusMeta: StatusMeta;
  isAdmin: boolean;
  onCreateSlot: (date: string, time: string) => void;
  onEditAppointment: (id: number) => void;
  onMoveAppointment: (id: number, date: string, time: string) => void;
};

// ─── ثابت‌ها و ابزارها ─────────────────────────────────────────────────────────

const START_HOUR = 8;
const END_HOUR = 21; // آخرین ردیف: ۲۱:۰۰
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
const WEEKDAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shamsiDayMonth(d: Date): string {
  return new Intl.DateTimeFormat("fa-IR", { calendar: "persian", day: "numeric", month: "long" }).format(d);
}

function shamsiFull(d: Date): string {
  return new Intl.DateTimeFormat("fa-IR", { calendar: "persian", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d);
}

function shamsiMonthYear(d: Date): string {
  return new Intl.DateTimeFormat("fa-IR", { calendar: "persian", month: "long", year: "numeric" }).format(d);
}

/** شروع هفته شمسی (شنبه) برای یک تاریخ میلادی */
function startOfShamsiWeek(d: Date): Date {
  const obj = new DateObject({ date: d, calendar: persian, locale: persian_fa });
  // در تقویم فارسی، شنبه ایندکس ۰ دارد
  const shifted = obj.subtract(obj.weekDay.index, "days");
  const js = shifted.toDate();
  js.setHours(0, 0, 0, 0);
  return js;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function apptTime(ms: number): { hour: number; minute: number } {
  const d = new Date(ms);
  return { hour: d.getHours(), minute: d.getMinutes() };
}

/** ساعت نوبت را داخل بازه شبکه نگه می‌دارد تا نوبت‌های خارج از ساعت کاری هم دیده شوند */
function clampHour(h: number): number {
  return Math.min(Math.max(h, START_HOUR), END_HOUR);
}

// ─── بلوک نوبت ─────────────────────────────────────────────────────────────────

function AppointmentBlock({
  app, statusMeta, conflict, isAdmin, onEdit, onDragStart,
}: {
  app: CalendarAppointment;
  statusMeta: StatusMeta;
  conflict: boolean;
  isAdmin: boolean;
  onEdit: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const { hour, minute } = apptTime(app.scheduledAt);
  const meta = statusMeta[app.status];
  return (
    <button
      type="button"
      draggable={isAdmin}
      onDragStart={onDragStart}
      onClick={onEdit}
      data-testid={`calendar-appt-${app.id}`}
      title={`${app.patientName ?? ""} — ${app.serviceName ?? ""}${conflict ? " (تداخل زمانی!)" : ""}`}
      className={cn(
        "w-full text-right rounded-md border px-1.5 py-1 text-[11px] leading-4 transition-shadow",
        meta?.color ?? "bg-gray-100 text-gray-600 border-gray-200",
        app.status === "cancelled" && "opacity-50 line-through",
        conflict && "ring-2 ring-red-500 ring-offset-1",
        isAdmin && "cursor-grab active:cursor-grabbing hover:shadow-md",
      )}
    >
      <span className="flex items-center gap-1">
        {conflict && <AlertTriangle className="h-3 w-3 shrink-0 text-red-600" />}
        <span className="font-bold tabular-nums shrink-0">
          {toPersianDigits(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`)}
        </span>
        <span className="truncate font-medium">{app.patientName ?? "—"}</span>
      </span>
      <span className="block truncate text-[10px] opacity-80">{app.serviceName ?? ""}</span>
    </button>
  );
}

// ─── تقویم ─────────────────────────────────────────────────────────────────────

export function AppointmentCalendar({
  appointments, statusMeta, isAdmin, onCreateSlot, onEditAppointment, onMoveAppointment,
}: Props) {
  const [mode, setMode] = useState<"week" | "day">("week");
  const [anchor, setAnchor] = useState<Date>(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const days = useMemo(() => {
    if (mode === "day") return [anchor];
    const start = startOfShamsiWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [mode, anchor]);

  // نوبت‌ها را در سطل «روز/ساعت» گروه‌بندی می‌کنیم
  const buckets = useMemo(() => {
    const map = new Map<string, CalendarAppointment[]>();
    for (const app of appointments) {
      const d = new Date(app.scheduledAt);
      const key = `${dateKey(d)}|${clampHour(d.getHours())}`;
      const arr = map.get(key) ?? [];
      arr.push(app);
      map.set(key, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.scheduledAt - b.scheduledAt);
    return map;
  }, [appointments]);

  // تداخل: دو نوبت فعال با زمان شروع یکسان (دقیقه‌به‌دقیقه)
  const conflictIds = useMemo(() => {
    const byExactTime = new Map<number, number>();
    const ids = new Set<number>();
    const active = appointments.filter(a => a.status !== "cancelled");
    for (const app of active) {
      byExactTime.set(app.scheduledAt, (byExactTime.get(app.scheduledAt) ?? 0) + 1);
    }
    for (const app of active) {
      if ((byExactTime.get(app.scheduledAt) ?? 0) > 1) ids.add(app.id);
    }
    return ids;
  }, [appointments]);

  const today = new Date();

  function navigate(dir: 1 | -1) {
    setAnchor(prev => addDays(prev, dir * (mode === "week" ? 7 : 1)));
  }

  function handleDrop(e: React.DragEvent, day: Date, hour: number) {
    e.preventDefault();
    setDragOverKey(null);
    const idStr = e.dataTransfer.getData("text/appointment-id");
    const minuteStr = e.dataTransfer.getData("text/appointment-minute");
    const id = Number(idStr);
    if (!id) return;
    const minute = Number(minuteStr) || 0;
    onMoveAppointment(id, dateKey(day), `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
  }

  const title = mode === "day"
    ? shamsiFull(anchor)
    : `${shamsiDayMonth(days[0])} تا ${shamsiDayMonth(days[6])} — ${shamsiMonthYear(days[3])}`;

  return (
    <div className="space-y-3" data-testid="appointment-calendar">
      {/* نوار ابزار تقویم */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => navigate(-1)} data-testid="calendar-prev" aria-label="قبلی">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={() => { const d = new Date(); d.setHours(0, 0, 0, 0); setAnchor(d); }} data-testid="calendar-today">
            امروز
          </Button>
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => navigate(1)} data-testid="calendar-next" aria-label="بعدی">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="mr-2 text-sm font-medium" data-testid="calendar-title">{title}</span>
        </div>
        <div className="flex items-center gap-1 rounded-md border p-0.5">
          <Button size="sm" variant={mode === "day" ? "default" : "ghost"} className="h-7 px-3" onClick={() => setMode("day")} data-testid="calendar-mode-day">روز</Button>
          <Button size="sm" variant={mode === "week" ? "default" : "ghost"} className="h-7 px-3" onClick={() => setMode("week")} data-testid="calendar-mode-week">هفته</Button>
        </div>
      </div>

      {/* شبکه تقویم */}
      <div className="overflow-x-auto rounded-lg border">
        <div className="min-w-[640px]">
          {/* سربرگ روزها */}
          <div className="grid border-b bg-muted/50" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
            <div />
            {days.map((day, i) => {
              const isToday = isSameDay(day, today);
              return (
                <div key={dateKey(day)} className={cn("border-r px-2 py-2 text-center", isToday && "bg-primary/10")}>
                  <div className="text-xs font-bold">{mode === "week" ? WEEKDAYS[i] : WEEKDAYS[new DateObject({ date: day, calendar: persian }).weekDay.index]}</div>
                  <div className={cn("text-[11px] text-muted-foreground", isToday && "font-bold text-primary")}>{shamsiDayMonth(day)}</div>
                </div>
              );
            })}
          </div>

          {/* ردیف‌های ساعت */}
          {HOURS.map(hour => (
            <div key={hour} className="grid border-b last:border-b-0" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
              <div className="border-l bg-muted/30 px-1 py-1 text-center text-[11px] tabular-nums text-muted-foreground">
                {toPersianDigits(`${String(hour).padStart(2, "0")}:00`)}
              </div>
              {days.map(day => {
                const key = `${dateKey(day)}|${hour}`;
                const apps = buckets.get(key) ?? [];
                const isToday = isSameDay(day, today);
                return (
                  <div
                    key={key}
                    className={cn(
                      "group relative min-h-[44px] border-r p-0.5 space-y-0.5 transition-colors",
                      isToday && "bg-primary/5",
                      dragOverKey === key && "bg-primary/15 outline outline-2 outline-primary/40 -outline-offset-2",
                    )}
                    onDragOver={isAdmin ? (e) => { e.preventDefault(); setDragOverKey(key); } : undefined}
                    onDragLeave={isAdmin ? () => setDragOverKey(prev => (prev === key ? null : prev)) : undefined}
                    onDrop={isAdmin ? (e) => handleDrop(e, day, hour) : undefined}
                    data-testid={`calendar-cell-${dateKey(day)}-${hour}`}
                  >
                    {apps.map(app => (
                      <AppointmentBlock
                        key={app.id}
                        app={app}
                        statusMeta={statusMeta}
                        conflict={conflictIds.has(app.id)}
                        isAdmin={isAdmin}
                        onEdit={() => onEditAppointment(app.id)}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/appointment-id", String(app.id));
                          e.dataTransfer.setData("text/appointment-minute", String(apptTime(app.scheduledAt).minute));
                          e.dataTransfer.effectAllowed = "move";
                        }}
                      />
                    ))}
                    {/* دکمه ثبت نوبت در خانه خالی */}
                    <button
                      type="button"
                      className={cn(
                        "w-full items-center justify-center gap-1 rounded border border-dashed border-transparent py-0.5 text-[10px] text-muted-foreground/0 transition-colors",
                        "hidden group-hover:flex hover:border-primary/40 hover:text-primary",
                        apps.length === 0 && "absolute inset-0.5 h-auto",
                      )}
                      onClick={() => onCreateSlot(dateKey(day), `${String(hour).padStart(2, "0")}:00`)}
                      data-testid={`calendar-create-${dateKey(day)}-${hour}`}
                    >
                      <Plus className="h-3 w-3" />
                      نوبت جدید
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* راهنما */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {Object.entries(statusMeta).map(([key, { label, color }]) => (
          <Badge key={key} variant="outline" className={cn("text-[10px] font-normal", color)}>{label}</Badge>
        ))}
        <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-red-600" /> تداخل زمانی</span>
        {isAdmin && <span>· برای جابه‌جایی، نوبت را بکشید و در خانه جدید رها کنید</span>}
      </div>
    </div>
  );
}
