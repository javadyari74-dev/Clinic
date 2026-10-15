import { useGetServicePriceHistory, getGetServicePriceHistoryQueryKey } from "@workspace/api-client-react";
import type { ServicePriceChange } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatShamsiDate, toPersianDigits } from "@/lib/format";
import { History, ArrowLeft } from "lucide-react";

// ─── تاریخچهٔ قیمت و هزینهٔ یک خدمت ──────────────────────────────────────────
// هر ردیف یک «نسخه» است که از تاریخش به بعد معتبر بوده؛ سود نوبت‌ها با نسخهٔ روز خدمت حساب می‌شود.

const FIELD_LABELS: Record<string, string> = {
  price: "قیمت",
  priceMode: "نحوهٔ قیمت",
  unitCount: "تعداد واحد",
  doctorFee: "دستمزد پزشک",
  doctorFeeMode: "نحوهٔ دستمزد پزشک",
  materialCost: "هزینهٔ مواد مصرفی",
  materialCostMode: "نحوهٔ هزینهٔ مواد",
  otherCost: "سایر هزینه‌ها",
  otherCostMode: "نحوهٔ سایر هزینه‌ها",
};
const MODE_LABELS: Record<string, string> = { total: "کل خدمت", per_unit: "به ازای هر واحد" };

function valueText(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (field.endsWith("Mode")) return MODE_LABELS[String(v)] ?? String(v);
  if (field === "unitCount") return toPersianDigits(Number(v));
  return formatCurrency(Number(v));
}

function versionCost(v: ServicePriceChange): number {
  const part = (fee: number, mode: string) => (mode === "per_unit" ? fee * (v.unitCount || 1) : fee);
  return part(v.doctorFee, v.doctorFeeMode) + part(v.materialCost, v.materialCostMode) + part(v.otherCost, v.otherCostMode);
}

export function ServicePriceHistoryDialog({
  service,
  onOpenChange,
}: {
  service: { id: number; name: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const id = service?.id ?? 0;
  const { data: history, isLoading } = useGetServicePriceHistory(id, {
    query: { enabled: !!service, queryKey: getGetServicePriceHistoryQueryKey(id) },
  });

  return (
    <Dialog open={!!service} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-amber-600" />
            تاریخچهٔ قیمت «{service?.name}»
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          سود هر نوبت با قیمت و هزینه‌ای حساب می‌شود که در روز انجام خدمت معتبر بوده است.
        </p>
        {isLoading && <p className="text-sm text-muted-foreground py-4">در حال بارگذاری…</p>}
        <div className="space-y-3">
          {(history ?? []).map((v, i) => {
            const price = v.priceMode === "per_unit" ? v.price * (v.unitCount || 1) : v.price;
            const cost = versionCost(v);
            return (
              <div key={v.id} className={`rounded-lg border p-3 space-y-2 ${i === 0 ? "border-primary/40 bg-primary/5" : ""}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold">
                    {v.effectiveFrom > 0 ? `از ${formatShamsiDate(v.effectiveFrom, true)}` : "از ابتدا"}
                  </span>
                  {i === 0 && <Badge className="text-xs">قیمت فعلی</Badge>}
                  {v.changedBy && <span className="text-xs text-muted-foreground">ثبت: {v.changedBy}</span>}
                  {v.effectiveFrom > 0 && Math.abs(v.createdAt - v.effectiveFrom) > 3600 && (
                    <span className="text-xs text-muted-foreground">(ثبت در {formatShamsiDate(v.createdAt, true)})</span>
                  )}
                </div>
                {v.changes.length > 0 ? (
                  <ul className="space-y-1 text-sm">
                    {v.changes.map((c) => (
                      <li key={c.field} className="flex flex-wrap items-center gap-1.5">
                        <span className="text-muted-foreground">{FIELD_LABELS[c.field] ?? c.field}:</span>
                        <span className="line-through text-muted-foreground">{valueText(c.field, c.from)}</span>
                        <ArrowLeft className="h-3 w-3 text-muted-foreground" />
                        <span className="font-semibold">{valueText(c.field, c.to)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{v.note || "قیمت اولیه"}</p>
                )}
                {v.changes.length > 0 && v.note && <p className="text-sm">توضیح: {v.note}</p>}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground border-t pt-2">
                  <span>قیمت: <span className="text-foreground">{formatCurrency(price)}</span></span>
                  <span>هزینهٔ کل: <span className="text-orange-600">{formatCurrency(cost)}</span></span>
                  <span>سود هر نوبت: <span className={price - cost >= 0 ? "text-green-700" : "text-red-600"}>{formatCurrency(price - cost)}</span></span>
                </div>
              </div>
            );
          })}
          {!isLoading && history?.length === 0 && (
            <p className="text-sm text-muted-foreground py-4">تاریخچه‌ای ثبت نشده است.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
