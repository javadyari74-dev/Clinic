import DatePicker, { DateObject } from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import gregorian from "react-date-object/calendars/gregorian";
import gregorian_en from "react-date-object/locales/gregorian_en";
import { CalendarDays, X } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"];

/** Convert Gregorian "YYYY-MM-DD" → DateObject in Persian calendar */
function gregToPersian(isoStr?: string): DateObject | undefined {
  if (!isoStr) return undefined;
  try {
    const parts = isoStr.split("-").map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return undefined;
    const greg = new DateObject({ calendar: gregorian, locale: gregorian_en, year: parts[0], month: parts[1], day: parts[2] });
    return greg.convert(persian, persian_fa);
  } catch { return undefined; }
}

/** Format a Persian DateObject for display */
function persianDisplay(obj?: DateObject): string {
  if (!obj) return "";
  const m = obj.month.number - 1;
  return `${obj.day} ${MONTHS[m]} ${obj.year}`;
}

// ─── PersianDatePicker ────────────────────────────────────────────────────────

interface PersianDatePickerProps {
  /** Gregorian YYYY-MM-DD string */
  value?: string;
  /** Called with Gregorian YYYY-MM-DD, or "" when cleared */
  onChange: (value: string) => void;
  placeholder?: string;
  /** Minimum Shamsi year (default 1330) */
  minYear?: number;
  /** Maximum Shamsi year */
  maxYear?: number;
  className?: string;
}

export function PersianDatePicker({
  value,
  onChange,
  placeholder = "انتخاب تاریخ...",
  minYear = 1330,
  maxYear,
}: PersianDatePickerProps) {
  const dateValue = gregToPersian(value);
  const display = persianDisplay(dateValue);

  return (
    <DatePicker
      value={dateValue}
      onChange={(date: DateObject | null) => {
        if (!date) { onChange(""); return; }
        const greg = date.convert(gregorian, gregorian_en);
        const y = greg.year;
        const m = String(greg.month.number).padStart(2, "0");
        const d = String(greg.day).padStart(2, "0");
        onChange(`${y}-${m}-${d}`);
      }}
      calendar={persian}
      locale={persian_fa}
      calendarPosition="bottom-right"
      minDate={new DateObject({ calendar: persian, year: minYear, month: 1, day: 1 })}
      maxDate={maxYear ? new DateObject({ calendar: persian, year: maxYear, month: 12, day: 29 }) : undefined}
      render={(_value: string, openCalendar: () => void) => (
        <div
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background cursor-pointer items-center gap-2 hover:bg-accent/40 transition-colors select-none"
          onClick={openCalendar}
        >
          <CalendarDays className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className={`flex-1 text-right ${display ? "text-foreground" : "text-muted-foreground"}`}>
            {display || placeholder}
          </span>
          {value && (
            <span
              className="text-muted-foreground hover:text-destructive transition-colors"
              onClick={(e) => { e.stopPropagation(); onChange(""); }}
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      )}
      containerStyle={{ width: "100%", display: "block" }}
    />
  );
}
