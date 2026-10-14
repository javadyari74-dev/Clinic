import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { SortableHead } from "@/components/sortable-head";
import { useTableSort } from "@/hooks/use-table-sort";
import {
  useProfitDetails, readMinMarginPct,
  type AccountingSummary, type DateRange, type ProfitPeriod, type ProfitVisit, type ServiceProfitDetail,
} from "@/hooks/use-accounting";
import { formatCurrency, formatShamsiDate, toPersianDigits } from "@/lib/format";
import { cn } from "@/lib/utils";
import { exportCsv, csvDate } from "@/lib/export-csv";
import { ChevronDown, PiggyBank, Search, TrendingDown, TrendingUp, Minus, FileSpreadsheet } from "lucide-react";

// ─── ریز سود: هر خدمت با هزینهٔ پزشک/مواد/سایر و سود، و تغییر سود در طول زمان ─────────
// «دوره» = بازه‌ای که یک نسخهٔ قیمت/هزینهٔ خدمت معتبر بوده (از تاریخچهٔ قیمت خدمات)؛
// تغییر سود بین دوره‌ها نشان می‌دهد گرانی مواد یا دستمزد چقدر از سود هر نوبت کم کرده است.
// تفاوت نوبت‌های یک دوره هم از مبلغ واقعاً دریافتی (تخفیف/چانه‌زنی) می‌آید.

type SortKey = "profit" | "revenue" | "count" | "change";

/** تغییر سود هر نوبت: دورهٔ آخر نسبت به دورهٔ قبل؛ اگر یک دوره بود، نوبت آخر نسبت به نوبت قبل */
function profitChange(s: ServiceProfitDetail): { from: number; to: number; basis: "period" | "visit" } | null {
  if (s.periods.length >= 2) {
    const [prev, last] = s.periods.slice(-2);
    return { from: prev.avgProfit, to: last.avgProfit, basis: "period" };
  }
  const counted = s.visits.filter((v) => v.counted);
  if (counted.length >= 2) {
    const [prev, last] = counted.slice(-2);
    return { from: prev.profit, to: last.profit, basis: "visit" };
  }
  return null;
}

function Delta({ from, to, className }: { from: number; to: number; className?: string }) {
  const d = to - from;
  if (d === 0) return <span className={cn("inline-flex items-center gap-0.5 text-muted-foreground", className)}><Minus className="h-3 w-3" />بدون تغییر</span>;
  const up = d > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-semibold", up ? "text-green-700" : "text-red-600", className)}>
      <Icon className="h-3.5 w-3.5" />
      {up ? "افزایش " : "کاهش "}{formatCurrency(Math.abs(d))}
    </span>
  );
}

function periodLabel(p: ProfitPeriod) {
  return p.versionFrom > 0 ? `قیمت از ${formatShamsiDate(p.versionFrom)}` : "قیمت اولیه";
}

function Money({ v, className }: { v: number; className?: string }) {
  return <span className={cn("whitespace-nowrap", className)}>{formatCurrency(v)}</span>;
}

function VisitsTable({ visits }: { visits: ProfitVisit[] }) {
  // تغییر سود هر نوبت نسبت به نوبت قبلیِ همین خدمت (به ترتیب زمان)
  const prevProfit = useMemo(() => {
    const m = new Map<number, number | null>();
    let last: number | null = null;
    for (const v of visits) {
      m.set(v.appointmentId, v.counted ? last : null);
      if (v.counted) last = v.profit;
    }
    return m;
  }, [visits]);
  const sort = useTableSort(visits, {
    date: (v) => v.serviceDate,
    patient: (v) => v.patientName ?? "",
    revenue: (v) => v.revenue,
    doctor: (v) => v.doctorCost,
    material: (v) => v.materialCost,
    other: (v) => v.otherCost,
    commission: (v) => v.commission,
    profit: (v) => v.profit,
  });
  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow>
          <SortableHead {...sort.head("date")}>تاریخ خدمت</SortableHead>
          <SortableHead {...sort.head("patient")}>مراجع</SortableHead>
          <SortableHead {...sort.head("revenue")}>دریافتی</SortableHead>
          <SortableHead {...sort.head("doctor")}>پزشک</SortableHead>
          <SortableHead {...sort.head("material")}>مواد</SortableHead>
          <SortableHead {...sort.head("other")}>سایر</SortableHead>
          <SortableHead {...sort.head("commission")}>پورسانت</SortableHead>
          <SortableHead {...sort.head("profit")}>سود</SortableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sort.sorted.map((v) => {
          const prev = prevProfit.get(v.appointmentId);
          return (
            <TableRow key={v.appointmentId}>
              <TableCell className="whitespace-nowrap">{formatShamsiDate(v.serviceDate)}</TableCell>
              <TableCell className="whitespace-nowrap">
                {v.patientId
                  ? <Link href={`/patients/${v.patientId}`} className="text-primary hover:underline">{v.patientName ?? "—"}</Link>
                  : (v.patientName ?? "—")}
              </TableCell>
              <TableCell><Money v={v.revenue} /></TableCell>
              <TableCell className="text-muted-foreground">{v.counted ? <Money v={v.doctorCost} /> : "—"}</TableCell>
              <TableCell className="text-muted-foreground">{v.counted ? <Money v={v.materialCost} /> : "—"}</TableCell>
              <TableCell className="text-muted-foreground">{v.counted ? <Money v={v.otherCost} /> : "—"}</TableCell>
              <TableCell className="text-muted-foreground">{v.commission ? <Money v={v.commission} /> : "—"}</TableCell>
              <TableCell>
                <div className={cn("font-bold", v.profit >= 0 ? "text-green-700" : "text-red-600")}><Money v={v.profit} /></div>
                {prev != null && <Delta from={prev} to={v.profit} className="text-[10px]" />}
                {!v.counted && <div className="text-[10px] text-muted-foreground">قسط؛ هزینه در بازهٔ دیگر</div>}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function ServiceRow({ s, open, onToggle, minMargin }: { s: ServiceProfitDetail; open: boolean; onToggle: () => void; minMargin: number }) {
  const change = profitChange(s);
  const avg = s.count > 0 ? Math.round(s.profit / s.count) : null;
  return (
    <div className="rounded-2xl border bg-card overflow-hidden" data-testid={`profit-service-${s.serviceId}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full text-right p-4 hover:bg-secondary/40 transition-colors">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-bold text-base">{s.serviceName}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {toPersianDigits(s.count)} نوبت{avg != null && <> · سود هر نوبت به‌طور میانگین <Money v={avg} /></>}
            </div>
          </div>
          <div className="text-left">
            <div className={cn("text-lg font-extrabold", s.profit >= 0 ? "text-green-700" : "text-red-600")}><Money v={s.profit} /></div>
            <Badge variant="secondary" className="text-[10px]">حاشیه {toPersianDigits(s.profitMargin)}٪</Badge>
            {s.revenue > 0 && s.profitMargin < minMargin && (
              <Badge className="text-[10px] mr-1 bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100">حاشیهٔ کم</Badge>
            )}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
          {([
            ["دریافتی", s.revenue, ""],
            ["دستمزد پزشک", s.doctorCost, "text-blue-700"],
            ["مواد مصرفی", s.materialCost, "text-purple-700"],
            ["سایر", s.otherCost, "text-orange-700"],
            ["پورسانت", s.commission, "text-amber-700"],
            ["سود", s.profit, s.profit >= 0 ? "text-green-700" : "text-red-600"],
          ] as const).map(([label, v, cls]) => (
            <div key={label} className="rounded-xl bg-secondary/60 px-2 py-1.5">
              <div className="text-muted-foreground">{label}</div>
              <div className={cn("font-semibold", cls)}><Money v={v} /></div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
          {change ? (
            <span className="flex flex-wrap items-center gap-1">
              <span className="text-muted-foreground">
                {change.basis === "period" ? "سود هر نوبت بعد از آخرین تغییر قیمت:" : "سود نوبت آخر نسبت به نوبت قبل:"}
              </span>
              <Money v={change.from} className="text-muted-foreground line-through" />
              <span>←</span>
              <Money v={change.to} className="font-semibold" />
              <Delta from={change.from} to={change.to} />
            </span>
          ) : <span className="text-muted-foreground">برای مقایسه حداقل دو نوبت لازم است</span>}
          <span className="flex items-center gap-1 text-primary font-semibold">
            {open ? "بستن" : "جزئیات"} <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </span>
        </div>
      </button>

      {open && (
        <div className="border-t bg-background/60 p-4 space-y-4">
          {s.periods.length > 0 && (
            <div>
              <div className="text-sm font-bold mb-2">سود هر نوبت در طول زمان (به تفکیک تغییر قیمت و هزینه)</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {s.periods.map((p, i) => {
                  const prev = i > 0 ? s.periods[i - 1] : null;
                  return (
                    <div key={p.versionFrom} className={cn("rounded-xl border p-3 text-xs space-y-1", i === s.periods.length - 1 && "border-primary/40 bg-primary/5")}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-sm">{periodLabel(p)}</span>
                        <span className="text-muted-foreground">{toPersianDigits(p.count)} نوبت</span>
                      </div>
                      <div className="text-muted-foreground">
                        {formatShamsiDate(p.firstDate)}{p.lastDate !== p.firstDate && <> تا {formatShamsiDate(p.lastDate)}</>}
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 pt-1">
                        <span>میانگین دریافتی: <Money v={p.avgRevenue} className="font-semibold" /></span>
                        <span>پزشک: <Money v={p.avgDoctorCost} /></span>
                        <span>مواد: <Money v={p.avgMaterialCost} /></span>
                        <span>سایر: <Money v={p.avgOtherCost} /></span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-1 border-t pt-1.5">
                        <span>سود هر نوبت: <Money v={p.avgProfit} className={cn("font-bold", p.avgProfit >= 0 ? "text-green-700" : "text-red-600")} /></span>
                        {prev && <Delta from={prev.avgProfit} to={p.avgProfit} />}
                      </div>
                      {prev && (
                        <div className="text-[11px] text-muted-foreground">
                          {[
                            p.avgDoctorCost !== prev.avgDoctorCost && `پزشک ${formatCurrency(Math.abs(p.avgDoctorCost - prev.avgDoctorCost))} ${p.avgDoctorCost > prev.avgDoctorCost ? "بیشتر" : "کمتر"}`,
                            p.avgMaterialCost !== prev.avgMaterialCost && `مواد ${formatCurrency(Math.abs(p.avgMaterialCost - prev.avgMaterialCost))} ${p.avgMaterialCost > prev.avgMaterialCost ? "بیشتر" : "کمتر"}`,
                            p.avgOtherCost !== prev.avgOtherCost && `سایر ${formatCurrency(Math.abs(p.avgOtherCost - prev.avgOtherCost))} ${p.avgOtherCost > prev.avgOtherCost ? "بیشتر" : "کمتر"}`,
                            p.avgRevenue !== prev.avgRevenue && `دریافتی ${formatCurrency(Math.abs(p.avgRevenue - prev.avgRevenue))} ${p.avgRevenue > prev.avgRevenue ? "بیشتر" : "کمتر"}`,
                          ].filter(Boolean).join(" · ") || "هزینه‌ها تغییری نکرده"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <div className="text-sm font-bold mb-2">نوبت به نوبت</div>
            <VisitsTable visits={s.visits} />
          </div>
        </div>
      )}
    </div>
  );
}

export function ProfitDetailsDialog({
  open,
  onOpenChange,
  range,
  rangeLabel,
  summary,
  exportLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  range: DateRange;
  rangeLabel: string;
  summary?: AccountingSummary;
  /** برچسب دوره برای نام فایل خروجی، مثلاً «مهر-۱۴۰۵» */
  exportLabel?: string;
}) {
  const { data, isLoading, isError } = useProfitDetails(range, open);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("profit");
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  // با هر بار باز شدن دوباره خوانده می‌شود تا تغییر تنظیم در صفحهٔ خدمات اعمال شود
  const minMargin = useMemo(() => readMinMarginPct(), [open]);

  const services = useMemo(() => {
    const term = q.trim();
    const list = (data?.services ?? []).filter((s) => !term || s.serviceName.includes(term) || (s.category ?? "").includes(term));
    const changeOf = (s: ServiceProfitDetail) => { const c = profitChange(s); return c ? c.to - c.from : 0; };
    return [...list].sort((a, b) =>
      sortKey === "revenue" ? b.revenue - a.revenue
      : sortKey === "count" ? b.count - a.count
      : sortKey === "change" ? changeOf(a) - changeOf(b) // بیشترین کاهش سود اول
      : b.profit - a.profit);
  }, [data, q, sortKey]);

  const totals = useMemo(() => {
    const t = { revenue: 0, doctor: 0, material: 0, other: 0, commission: 0, profit: 0 };
    for (const s of data?.services ?? []) {
      t.revenue += s.revenue; t.doctor += s.doctorCost; t.material += s.materialCost;
      t.other += s.otherCost; t.commission += s.commission; t.profit += s.profit;
    }
    return t;
  }, [data]);

  // خروجی اکسل: یک ردیف به ازای هر نوبتِ خدمت‌های در حال نمایش (همان جست‌وجو و ترتیب)
  function handleExport() {
    const rows = services.flatMap((s) => s.visits.map((v) => ({ s, v })));
    const label = (exportLabel ?? rangeLabel).trim().replace(/\s+/g, "-");
    exportCsv(`ریز-سود-${label}`, [
      { header: "خدمت", value: (r) => r.s.serviceName },
      { header: "تاریخ", value: (r) => csvDate(r.v.serviceDate) },
      { header: "مراجع", value: (r) => r.v.patientName ?? "" },
      { header: "دریافتی", value: (r) => r.v.revenue },
      { header: "پزشک", value: (r) => (r.v.counted ? r.v.doctorCost : 0) },
      { header: "مواد", value: (r) => (r.v.counted ? r.v.materialCost : 0) },
      { header: "سایر", value: (r) => (r.v.counted ? r.v.otherCost : 0) },
      { header: "پورسانت", value: (r) => r.v.commission },
      { header: "سود", value: (r) => r.v.profit },
    ], rows);
  }

  const toggle = (id: number) => setOpenIds((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PiggyBank className="h-5 w-5 text-primary" />
            ریز سود خدمات — {rangeLabel}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          سود هر نوبت = مبلغ واقعاً دریافتی − (دستمزد پزشک + مواد + سایر، با قیمت روز خدمت) − پورسانت. روی هر خدمت بزنید تا تغییر سود در طول زمان و نوبت‌ها را ببینید.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
          {([
            ["دریافتی خدمات", totals.revenue, ""],
            ["دستمزد پزشک", totals.doctor, "text-blue-700"],
            ["مواد مصرفی", totals.material, "text-purple-700"],
            ["سایر", totals.other, "text-orange-700"],
            ["پورسانت", totals.commission, "text-amber-700"],
            ["سود خدمات", totals.profit, totals.profit >= 0 ? "text-green-700" : "text-red-600"],
          ] as const).map(([label, v, cls]) => (
            <div key={label} className="rounded-xl border bg-card px-2 py-2">
              <div className="text-muted-foreground">{label}</div>
              <div className={cn("font-bold text-sm", cls)}><Money v={v} /></div>
            </div>
          ))}
        </div>
        {summary && (
          <p className="text-xs text-muted-foreground">
            سود خالص مطب ({formatCurrency(summary.netProfit)}) = سود خدمات
            {summary.laserRevenue - summary.laserCommissions !== 0 && <> + سود لیزر ({formatCurrency(summary.laserRevenue - summary.laserCommissions)})</>}
            {" "}− هزینه‌های ثابت ({formatCurrency(summary.expenses)})
            {summary.revenue !== totals.revenue && <> ± پرداخت/پورسانت بدون نوبت</>}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[12rem]">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجوی خدمت" className="pr-9" />
          </div>
          {([["profit", "بیشترین سود"], ["revenue", "بیشترین دریافتی"], ["count", "بیشترین نوبت"], ["change", "بیشترین افت سود"]] as const).map(([k, label]) => (
            <Button key={k} size="sm" variant={sortKey === k ? "default" : "outline"} onClick={() => setSortKey(k)}>{label}</Button>
          ))}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={handleExport} disabled={!services.length} data-testid="profit-details-export">
            <FileSpreadsheet className="h-4 w-4" />
            خروجی اکسل
          </Button>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground py-6 text-center">در حال محاسبه…</p>}
        {isError && <p className="text-sm text-destructive py-6 text-center">بارگذاری ریز سود ناموفق بود</p>}
        <div className="space-y-3">
          {services.map((s) => (
            <ServiceRow key={s.serviceId} s={s} open={openIds.has(s.serviceId)} onToggle={() => toggle(s.serviceId)} minMargin={minMargin} />
          ))}
          {!isLoading && data && services.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">در این بازه خدمتی با پرداخت ثبت نشده است</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
