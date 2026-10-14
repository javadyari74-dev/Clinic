import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { History, Search, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PersianDateRangePicker } from "@/components/persian-date-range-picker";
import { SortableHead } from "@/components/sortable-head";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { useTableSort } from "@/hooks/use-table-sort";
import type { DateRange } from "@/hooks/use-accounting";
import { formatShamsiDate, toPersianDigits } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ActivityLogItem {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  description: string;
  username: string | null;
  createdAt: number;
}

interface ActivityLogPage {
  items: ActivityLogItem[];
  total: number;
  hasMore: boolean;
  entityTypes: string[];
  actions: string[];
}

export const ACTION_LABELS: Record<string, string> = {
  create: "ثبت",
  update: "ویرایش",
  delete: "حذف",
  restore: "بازیابی",
  merge: "ادغام",
  send: "ارسال",
  login: "ورود",
};

export const ENTITY_LABELS: Record<string, string> = {
  payment: "پرداخت",
  appointment: "نوبت",
  patient: "مراجع",
  service: "خدمت",
  purchase: "خرید",
  staff: "کارمند",
  discount: "تخفیف",
  inventory: "انبار",
  expense: "هزینه",
  commission: "کمیسیون",
  commission_recipient: "گیرندهٔ کمیسیون",
  reminder: "یادآوری",
  patient_note: "یادداشت مراجع",
  sms: "پیامک",
  survey: "نظرسنجی",
  loyalty: "باشگاه مشتریان",
  waiting_list: "لیست انتظار",
  settings: "تنظیمات",
  user: "کاربر",
  backup: "پشتیبان",
  laser: "لیزر",
};

const actionLabel = (a: string) => ACTION_LABELS[a] ?? a;
const entityLabel = (e: string) => ENTITY_LABELS[e] ?? e;

const ACTION_STYLES: Record<string, string> = {
  create: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  update: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  delete: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

const PAGE_SIZE = 50;
const ALL = "all";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function ActivityLogPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [entityType, setEntityType] = useState(ALL);
  const [action, setAction] = useState(ALL);
  const [range, setRange] = useState<DateRange | null>(null);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);

  const filters = useMemo(() => {
    const p = new URLSearchParams();
    if (entityType !== ALL) p.set("entityType", entityType);
    if (action !== ALL) p.set("action", action);
    // انتهای بازهٔ انتخابگر انحصاری است؛ سرور «تا» را شامل می‌داند
    if (range) {
      p.set("from", String(range.from));
      p.set("to", String(range.to - 1));
    }
    if (q) p.set("q", q);
    return p.toString();
  }, [entityType, action, range, q]);

  const query = useInfiniteQuery({
    queryKey: ["/api/activity/log", filters],
    enabled: isAdmin,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      customFetch<ActivityLogPage>(
        `/api/activity/log?${filters}${filters ? "&" : ""}limit=${PAGE_SIZE}&offset=${pageParam}`,
      ),
    getNextPageParam: (last, pages) =>
      last?.hasMore ? pages.reduce((n, p) => n + (p?.items?.length ?? 0), 0) : undefined,
  });

  const pages = query.data?.pages;
  const rows = useMemo(() => (pages ?? []).flatMap((p) => p?.items ?? []), [pages]);
  const first = pages?.[0];
  const total = first?.total ?? 0;

  // گزینه‌های فیلتر: برچسب‌های شناخته‌شده + هر نوعی که در داده‌ها هست
  const entityOptions = useMemo(
    () => Array.from(new Set([...(first?.entityTypes ?? []), ...(entityType !== ALL ? [entityType] : [])])),
    [first?.entityTypes, entityType],
  );
  const actionOptions = useMemo(
    () => Array.from(new Set([...(first?.actions ?? []), ...(action !== ALL ? [action] : [])])),
    [first?.actions, action],
  );

  const sort = useTableSort(rows, {
    time: (r) => r.createdAt,
    user: (r) => r.username ?? "",
    action: (r) => actionLabel(r.action),
    entity: (r) => entityLabel(r.entityType),
    description: (r) => r.description,
  });

  const hasFilters = entityType !== ALL || action !== ALL || range !== null || search !== "";
  const clearFilters = () => {
    setEntityType(ALL);
    setAction(ALL);
    setRange(null);
    setSearch("");
  };

  if (!isAdmin) {
    return <div className="text-center py-20 text-muted-foreground">شما دسترسی به این بخش ندارید</div>;
  }

  return (
    <div className="space-y-6" dir="rtl">
      <PageHeader
        icon={<History />}
        title="تاریخچهٔ تغییرات"
        description="چه کسی، چه زمانی، چه چیزی را ثبت، ویرایش یا حذف کرده است"
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 py-4">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جست‌وجو در شرح یا نام کاربر…"
              className="pr-9"
              aria-label="جست‌وجو"
            />
          </div>
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger className="w-[160px]" aria-label="بخش">
              <SelectValue placeholder="همهٔ بخش‌ها" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>همهٔ بخش‌ها</SelectItem>
              {entityOptions.map((e) => (
                <SelectItem key={e} value={e}>
                  {entityLabel(e)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="w-[140px]" aria-label="نوع تغییر">
              <SelectValue placeholder="همهٔ تغییرها" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>همهٔ تغییرها</SelectItem>
              {actionOptions.map((a) => (
                <SelectItem key={a} value={a}>
                  {actionLabel(a)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <PersianDateRangePicker value={range} onChange={setRange} placeholder="همهٔ تاریخ‌ها" active={range !== null} />
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground">
              <X className="h-4 w-4" /> پاک کردن فیلترها
            </Button>
          )}
        </CardContent>
      </Card>

      {query.isLoading ? (
        <div className="text-center py-10 text-muted-foreground">در حال بارگذاری...</div>
      ) : query.isError ? (
        <div className="text-center py-10 text-destructive">خطا در دریافت تاریخچهٔ تغییرات</div>
      ) : rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <History className="h-6 w-6" />
            </div>
            <p>{hasFilters ? "با این فیلترها تغییری پیدا نشد" : "هنوز تغییری ثبت نشده است"}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Badge variant="secondary" className="text-xs">
            {toPersianDigits(rows.length)} از {toPersianDigits(total)} مورد
          </Badge>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHead {...sort.head("time")} className="w-[170px]">زمان</SortableHead>
                      <SortableHead {...sort.head("user")} className="w-[110px]">کاربر</SortableHead>
                      <SortableHead {...sort.head("action")} className="w-[90px]">تغییر</SortableHead>
                      <SortableHead {...sort.head("entity")} className="w-[120px]">بخش</SortableHead>
                      <SortableHead {...sort.head("description")}>شرح</SortableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sort.sorted.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatShamsiDate(r.createdAt, true)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {r.username ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
                              ACTION_STYLES[r.action] ?? "bg-muted text-muted-foreground",
                            )}
                          >
                            {actionLabel(r.action)}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {entityLabel(r.entityType)}
                          {r.entityId ? (
                            <span className="mr-1 text-xs text-muted-foreground">#{toPersianDigits(r.entityId)}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="min-w-[240px] break-words">{r.description}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          {query.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                {query.isFetchingNextPage ? "در حال بارگذاری..." : "نمایش موارد بیشتر"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
