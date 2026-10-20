import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PersianDatePicker } from "@/components/persian-date-picker";
import { formatShamsiDate, toPersianDigits } from "@/lib/format";
import { tehranTodayISO } from "@/lib/tehran-date";

// ─── «نوبت بعدی» هنگام تسویه در صندوق ─────────────────────────────────────────
// همهٔ محاسبات تاریخ/ساعت به وقت تهران (UTC+03:30 ثابت) است.

const TEHRAN_OFFSET_MS = 3.5 * 3600 * 1000;
const QUICK_DAYS = [7, 14, 30, 60];

export interface NextAppointmentValue {
  enabled: boolean;
  mode: "days" | "date";
  days: string;
  date: string; // میلادی YYYY-MM-DD
  time: string; // HH:MM
}

export const EMPTY_NEXT_APPOINTMENT: NextAppointmentValue = {
  enabled: false,
  mode: "days",
  days: "30",
  date: "",
  time: "",
};

/** ساعت HH:MM یک لحظه (میلی‌ثانیه) به وقت تهران */
export function tehranHHMM(ms: number): string {
  return new Date(ms + TEHRAN_OFFSET_MS).toISOString().slice(11, 16);
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** روزِ نوبت بعدی (میلادی YYYY-MM-DD) یا null */
export function nextAppointmentDate(v: NextAppointmentValue, now = Date.now()): string | null {
  if (v.mode === "date") return /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : null;
  const n = Number.parseInt(v.days, 10);
  if (!Number.isFinite(n) || n < 1 || n > 3650) return null;
  return addDaysIso(tehranTodayISO(now), n);
}

/** لحظهٔ نوبت بعدی به میلی‌ثانیه (ساعت به وقت تهران) یا null اگر ورودی ناقص است */
export function nextAppointmentMs(v: NextAppointmentValue, now = Date.now()): number | null {
  const iso = nextAppointmentDate(v, now);
  const t = /^(\d{1,2}):(\d{2})$/.exec(v.time);
  if (!iso || !t) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const hh = Number(t[1]);
  const mm = Number(t[2]);
  if (hh > 23 || mm > 59) return null;
  return Date.UTC(y, m - 1, d, hh, mm) - TEHRAN_OFFSET_MS;
}

interface Props {
  value: NextAppointmentValue;
  onChange: (v: NextAppointmentValue) => void;
  /** فقط وقتی نوبتی انتخاب شده که خدمت و مراجع دارد */
  disabled?: boolean;
}

export function PaymentNextAppointment({ value, onChange, disabled }: Props) {
  const set = (patch: Partial<NextAppointmentValue>) => onChange({ ...value, ...patch });
  const ms = value.enabled ? nextAppointmentMs(value) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 font-medium cursor-pointer" htmlFor="next-appt-toggle">
          <CalendarPlus className="h-4 w-4 text-pink-600" />
          نوبت بعدی
        </Label>
        <Switch
          id="next-appt-toggle"
          disabled={disabled}
          checked={value.enabled && !disabled}
          onCheckedChange={(v) => set({ enabled: v })}
        />
      </div>
      {disabled && (
        <p className="text-xs text-muted-foreground">برای ثبت نوبت بعدی، ابتدا نوبت مرتبط را انتخاب کنید.</p>
      )}

      {value.enabled && !disabled && (
        <div className="space-y-3 rounded-lg border border-pink-200 p-3 bg-pink-50/40" data-testid="next-appointment">
          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_DAYS.map((d) => (
              <Button
                key={d}
                type="button"
                size="sm"
                variant={value.mode === "days" && value.days === String(d) ? "default" : "outline"}
                className="h-8"
                onClick={() => set({ mode: "days", days: String(d) })}
              >
                {toPersianDigits(d)} روز
              </Button>
            ))}
            <div className="flex items-center gap-1">
              <Input
                className="w-16 h-8"
                dir="ltr"
                inputMode="numeric"
                aria-label="تعداد روز دلخواه"
                value={value.mode === "days" ? value.days : ""}
                placeholder="روز"
                onChange={(e) => set({ mode: "days", days: e.target.value.replace(/[^\d]/g, "") })}
              />
              <span className="text-xs text-muted-foreground">روز بعد</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs mb-1 block">یا تاریخ مشخص</Label>
              <PersianDatePicker
                value={value.mode === "date" ? value.date : ""}
                onChange={(d) => set(d ? { mode: "date", date: d } : { mode: "days", date: "" })}
                placeholder="انتخاب تاریخ..."
              />
            </div>
            <div>
              <Label className="text-xs mb-1 block" htmlFor="next-appt-time">ساعت</Label>
              <Input
                id="next-appt-time"
                type="time"
                dir="ltr"
                value={value.time}
                onChange={(e) => set({ time: e.target.value })}
              />
            </div>
          </div>
          <div className="text-xs text-pink-700 bg-pink-100 rounded-md px-3 py-2">
            {ms
              ? <>نوبت بعدی: {formatShamsiDate(ms, true)} (همان مراجع، خدمت و پرسنل)</>
              : "تعداد روز یا تاریخ و ساعت نوبت بعدی را مشخص کنید"}
          </div>
        </div>
      )}
    </div>
  );
}
