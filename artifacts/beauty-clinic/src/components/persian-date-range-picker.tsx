import { useEffect, useState } from "react";
import DatePicker, { DateObject } from "react-multi-date-picker";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import { CalendarRange } from "lucide-react";
import type { DateRange } from "@/hooks/use-accounting";
import { formatRangeLabel, rangeFromDays } from "@/lib/shamsi-range";

interface PersianDateRangePickerProps {
  /** بازهٔ فعلی (ثانیهٔ یونیکس، to انحصاری) */
  value: DateRange | null;
  /** پس از انتخاب روز دوم فراخوانی می‌شود */
  onChange: (range: DateRange) => void;
  placeholder?: string;
  active?: boolean;
}

function toPickerValue(range: DateRange | null): DateObject[] {
  if (!range || range.from === 0) return [];
  return [
    new DateObject({ date: new Date(range.from * 1000), calendar: persian, locale: persian_fa }),
    new DateObject({ date: new Date((range.to - 1) * 1000), calendar: persian, locale: persian_fa }),
  ];
}

/** انتخاب بازهٔ تاریخ روی تقویم شمسی: روز اول و روز آخر را کلیک کنید. */
export function PersianDateRangePicker({
  value,
  onChange,
  placeholder = "بازهٔ دلخواه",
  active = false,
}: PersianDateRangePickerProps) {
  const [draft, setDraft] = useState<DateObject[]>(() => toPickerValue(value));
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.innerWidth >= 768);

  useEffect(() => setDraft(toPickerValue(value)), [value]);
  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <DatePicker
      range
      rangeHover
      value={draft}
      numberOfMonths={wide ? 2 : 1}
      onChange={(dates: DateObject[] | DateObject | null) => {
        const list = Array.isArray(dates) ? dates : dates ? [dates] : [];
        setDraft(list);
        if (list.length === 2) onChange(rangeFromDays(list[0].toDate(), list[1].toDate()));
      }}
      calendar={persian}
      locale={persian_fa}
      calendarPosition="bottom-left"
      render={(_value: string, openCalendar: () => void) => (
        <button
          type="button"
          onClick={openCalendar}
          className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors ${
            active
              ? "border-primary bg-primary text-primary-foreground"
              : "border-input bg-background hover:bg-accent/40"
          }`}
        >
          <CalendarRange className="h-4 w-4 shrink-0" />
          <span>{active && value ? formatRangeLabel(value) : placeholder}</span>
        </button>
      )}
    />
  );
}
