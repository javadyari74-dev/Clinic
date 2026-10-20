import { useEffect, useState } from "react";
import { customFetch, type Payment } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PersianDatePicker } from "@/components/persian-date-picker";
import { useToast } from "@/hooks/use-toast";
import { toastApiError } from "@/lib/api-error";
import { formatCurrency, toPersianDigits } from "@/lib/format";

// ─── تبدیل تاریخ پرداخت (ثانیهٔ یونیکس) ↔ تاریخ میلادی روز تهران ──────────────
const TEHRAN_OFFSET_SEC = 3.5 * 3600;
const DAY_SEC = 86_400;

/** تاریخ میلادی YYYY-MM-DD روزِ تهرانِ یک لحظه (ثانیه) */
export function paidAtToTehranDate(paidAt: number): string {
  return new Date((paidAt + TEHRAN_OFFSET_SEC) * 1000).toISOString().slice(0, 10);
}

/**
 * لحظهٔ جدید پرداخت وقتی تاریخ عوض می‌شود: نیمه‌شب همان روز به وقت تهران + ساعتِ قبلیِ پرداخت.
 * اگر تاریخ تغییر نکرده باشد خودِ paidAt برمی‌گردد.
 */
export function movePaidAtToDate(paidAt: number, isoDate: string): number {
  if (!isoDate || isoDate === paidAtToTehranDate(paidAt)) return paidAt;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return paidAt;
  const midnight = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000 - TEHRAN_OFFSET_SEC;
  const timeOfDay = (((paidAt + TEHRAN_OFFSET_SEC) % DAY_SEC) + DAY_SEC) % DAY_SEC;
  return midnight + timeOfDay;
}

const METHODS: Record<string, string> = {
  cash: "نقد",
  card: "کارت",
  transfer: "کارت به کارت",
  insurance: "بیمه",
};

const NEGOTIATED = "تخفیف توافقی";

interface Props {
  payment: Payment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** ویرایش پرداخت (فقط مدیر): سرور آثار پرداخت قبلی را برمی‌گرداند و با مقادیر جدید دوباره ثبت می‌کند */
export function PaymentEditDialog({ payment, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [originalAmount, setOriginalAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [unitsUsed, setUnitsUsed] = useState("");
  const [settleInFull, setSettleInFull] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!payment || !open) return;
    setAmount(String(payment.amount));
    setOriginalAmount(String(payment.originalAmount));
    setMethod(payment.method);
    setDate(paidAtToTehranDate(payment.paidAt));
    setNotes(payment.notes ?? "");
    setUnitsUsed(payment.unitsUsed ? String(payment.unitsUsed) : "");
    setSettleInFull((payment.discountName ?? "").includes(NEGOTIATED));
  }, [payment, open]);

  if (!payment) return null;

  const amountNum = Number.parseInt(amount || "0", 10);
  const originalNum = Number.parseInt(originalAmount || "0", 10);
  const unitsNum = unitsUsed ? Number.parseInt(unitsUsed, 10) : null;

  async function save() {
    if (!payment) return;
    if (!Number.isFinite(amountNum) || amountNum < 0 || !Number.isFinite(originalNum) || originalNum <= 0) {
      toast({ title: "مبلغ‌ها را درست وارد کنید", variant: "destructive" });
      return;
    }
    if (!date) {
      toast({ title: "تاریخ پرداخت را انتخاب کنید", variant: "destructive" });
      return;
    }
    if (unitsNum !== null && !(unitsNum > 0)) {
      toast({ title: "واحد مصرفی باید بیشتر از صفر باشد", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await customFetch<Payment>(`/api/payments/${payment.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: amountNum,
          originalAmount: originalNum,
          method,
          paidAt: movePaidAtToDate(payment.paidAt, date),
          notes: notes.trim() || null,
          unitsUsed: unitsNum,
          settleInFull,
        }),
      });
      // ویرایش پرداخت درآمد، کیف پول، باشگاه، کمیسیون، نوبت و گزارش‌ها را تغییر می‌دهد
      await queryClient.invalidateQueries();
      toast({ title: "پرداخت ویرایش شد", description: `مبلغ دریافتی: ${formatCurrency(amountNum)}` });
      onOpenChange(false);
    } catch (err) {
      toastApiError(err, "ویرایش پرداخت ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  const hasWalletOrPoints = (payment.walletAmount ?? 0) > 0 || (payment.pointsAmount ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>ویرایش پرداخت</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-md bg-muted/50 p-2 text-muted-foreground">
            {payment.patientName || "بدون مراجع"}
            {payment.serviceName ? ` — ${payment.serviceName}` : ""}
            {payment.sessionNumber ? ` (جلسه ${toPersianDigits(payment.sessionNumber)})` : ""}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="pe-original">مبلغ اصلی (تومان)</Label>
              <Input id="pe-original" dir="ltr" inputMode="numeric" value={originalAmount}
                onChange={(e) => setOriginalAmount(e.target.value.replace(/[^\d]/g, ""))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pe-amount">مبلغ دریافتی (تومان)</Label>
              <Input id="pe-amount" dir="ltr" inputMode="numeric" value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>روش پرداخت</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(METHODS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>تاریخ پرداخت</Label>
              <PersianDatePicker value={date} onChange={setDate} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pe-units">واحد مصرفی{payment.unitLabel ? ` (${payment.unitLabel})` : ""} — اختیاری</Label>
            <Input id="pe-units" dir="ltr" inputMode="numeric" value={unitsUsed}
              onChange={(e) => setUnitsUsed(e.target.value.replace(/[^\d]/g, ""))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pe-notes">یادداشت</Label>
            <Input id="pe-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex items-start gap-2">
            <Checkbox id="pe-settle" checked={settleInFull} onCheckedChange={(v) => setSettleInFull(Boolean(v))} />
            <label htmlFor="pe-settle" className="cursor-pointer leading-5">
              اگر مبلغ دریافتی کمتر از مانده است، اختلاف «تخفیف توافقی» ثبت شود (تسویه کامل، بدون بدهی)
            </label>
          </div>
          {hasWalletOrPoints && (
            <p className="text-xs text-amber-800 bg-amber-50 rounded-md p-2">
              مبلغ پرداخت‌شده از کیف پول/امتیاز ({formatCurrency((payment.walletAmount ?? 0) + (payment.pointsAmount ?? 0))}) بدون تغییر می‌ماند.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            همهٔ آثار این پرداخت (اعتبار سود باشگاه، پورسانت، تخفیف، وضعیت نوبت و گزارش‌ها) با مقادیر جدید دوباره محاسبه می‌شود.
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>انصراف</Button>
          <Button onClick={save} disabled={saving}>{saving ? "در حال ذخیره..." : "ذخیرهٔ تغییرات"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
