import { forwardRef, useEffect, useState, type ButtonHTMLAttributes } from "react";
import { useGetPatient, useListPatients, getGetPatientQueryKey, getListPatientsQueryKey } from "@workspace/api-client-react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

// انتخاب مراجع با جست‌وجوی سمت سرور (پارامتر q، با تأخیر کوتاه)؛ به‌جای بارگذاری
// همهٔ مراجعین (که فقط ۵۰۰ مراجعِ جدیدتر را می‌آورد). مراجعِ ازپیش‌انتخاب‌شده
// (مثلاً در ویرایش) حتی اگر در نتایج نباشد با نامش نشان داده می‌شود.

const SEARCH_LIMIT = 30;
const DEBOUNCE_MS = 250;

export interface PatientOption {
  id: number;
  name: string;
  fileNumber: string;
  phone: string;
}

type Props = {
  /** شناسهٔ مراجع انتخاب‌شده؛ 0/undefined یعنی هیچ */
  value: number | null | undefined;
  onChange: (id: number | undefined, patient?: PatientOption) => void;
  placeholder?: string;
  /** دکمهٔ پاک کردن انتخاب (برای فیلد اختیاری) */
  allowClear?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value" | "onChange">;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export const PatientSearchSelect = forwardRef<HTMLButtonElement, Props>(function PatientSearchSelect(
  { value, onChange, placeholder = "جستجو با نام، شماره پرونده یا تماس...", allowClear = false, className, ...buttonProps },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), DEBOUNCE_MS);
  const selectedId = value && value > 0 ? value : 0;

  const params = { q: q || undefined, limit: SEARCH_LIMIT };
  const { data, isLoading, isError, refetch } = useListPatients(params, {
    query: { enabled: open, queryKey: getListPatientsQueryKey(params) },
  });
  const results = data?.data ?? [];
  const inResults = results.find((p) => p.id === selectedId);
  const { data: fetched } = useGetPatient(selectedId, {
    query: { enabled: selectedId > 0 && !inResults, queryKey: getGetPatientQueryKey(selectedId) },
  });
  const selected: PatientOption | undefined = inResults ?? (fetched && fetched.id === selectedId ? fetched : undefined);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <div className="relative">
        <PopoverTrigger asChild>
          <Button
            ref={ref}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn("w-full justify-between font-normal", !selectedId && "text-muted-foreground", className)}
            {...buttonProps}
          >
            {selectedId ? (
              selected ? (
                <span className="truncate">{selected.name} <span className="text-muted-foreground text-xs mr-1">({selected.fileNumber})</span></span>
              ) : (
                <span className="text-muted-foreground">در حال بارگذاری...</span>
              )
            ) : placeholder}
            <ChevronsUpDown className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        {allowClear && selectedId > 0 && (
          <button
            type="button"
            aria-label="پاک کردن مراجع"
            className="absolute left-8 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); onChange(undefined); }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-[380px] p-0" align="start">
        {/* فیلتر سمت سرور است؛ فیلتر داخلی cmdk خاموش است */}
        <Command shouldFilter={false}>
          <CommandInput placeholder="نام، شماره پرونده یا تماس..." value={search} onValueChange={setSearch} />
          <CommandList>
            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">در حال جستجوی مراجعین...</div>
            ) : isError ? (
              <div className="py-6 px-4 text-center text-sm space-y-2">
                <p className="text-destructive">خطا در بارگذاری مراجعین</p>
                <Button type="button" size="sm" variant="outline" onClick={() => refetch()}>تلاش مجدد</Button>
              </div>
            ) : results.length === 0 ? (
              <CommandEmpty>{q ? "مراجعی یافت نشد" : "هنوز مراجعی ثبت نشده است"}</CommandEmpty>
            ) : null}
            <CommandGroup>
              {results.map((p) => (
                <CommandItem
                  key={p.id}
                  value={String(p.id)}
                  onSelect={() => { onChange(p.id, p); setOpen(false); }}
                >
                  <Check className={cn("ml-2 h-4 w-4", selectedId === p.id ? "opacity-100" : "opacity-0")} />
                  <div className="flex flex-col">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground">پرونده: {p.fileNumber} | {p.phone}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            {!q && (data?.total ?? 0) > results.length && (
              <div className="px-3 py-2 text-xs text-muted-foreground border-t">
                برای یافتن مراجعین دیگر نام، شماره پرونده یا تماس را تایپ کنید
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});
