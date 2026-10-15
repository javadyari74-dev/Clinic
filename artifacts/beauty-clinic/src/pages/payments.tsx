import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  useListPayments, useCreatePayment, useDeletePayment, getListPaymentsQueryKey,
  useListAppointments, getListAppointmentsQueryKey,
  useListDiscounts, useListStaff, useListCommissionRecipients,
  getListCommissionsQueryKey,
  getListRemindersQueryKey,
  useListPatients, getListPatientsQueryKey,
  getListPatientAccountTransactionsQueryKey, getGetPatientQueryKey,
  getGetPaymentQueryOptions,
  useGetPatientLoyalty, getGetPatientLoyaltyQueryKey,
  getListPatientAppointmentsQueryKey,
  useCreateAppointment, customFetch, type Payment,
} from "@workspace/api-client-react";
import { onApiError, toastApiError } from "@/lib/api-error";
import { LoyaltyTierBadge } from "@/components/loyalty-tier-badge";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { formatCurrency, formatShamsiDate, toPersianDigits, gregorianDateToUnix } from "@/lib/format";
import { Plus, Banknote, CreditCard, Trash2, Tag, Users, Receipt, Bell, Award, Pencil, Printer, MessageSquare, Search, FileSpreadsheet } from "lucide-react";
import { useLocation, useSearch } from "wouter";
import { PersianDateRangePicker } from "@/components/persian-date-range-picker";
import { presetRange, formatRangeLabel } from "@/lib/shamsi-range";
import type { DateRange } from "@/hooks/use-accounting";
import { exportCsv, csvDate } from "@/lib/export-csv";
import { PaymentEditDialog } from "@/components/payment-edit-dialog";
import {
  PaymentNextAppointment, EMPTY_NEXT_APPOINTMENT, nextAppointmentMs, tehranHHMM,
  type NextAppointmentValue,
} from "@/components/payment-next-appointment";
import { useAuth } from "@/hooks/use-auth";
import { PersianDatePicker } from "@/components/persian-date-picker";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { ErrorNotice } from "@/components/error-notice";
import { SortableHead } from "@/components/sortable-head";
import { useTableSort } from "@/hooks/use-table-sort";
import { useToast } from "@/hooks/use-toast";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Badge } from "@/components/ui/badge";

// فیلتر تاریخ صندوق
type DatePreset = "all" | "today" | "week" | "month" | "custom";
const DATE_PRESETS: { key: Exclude<DatePreset, "custom">; label: string }[] = [
  { key: "today", label: "امروز" },
  { key: "week", label: "این هفته" },
  { key: "month", label: "این ماه" },
  { key: "all", label: "همه" },
];

/** یکسان‌سازی حروف عربی/فارسی و بزرگی/کوچکی برای جست‌وجو */
function normalizeSearch(s: string): string {
  return s.trim().toLowerCase().replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/\u200c/g, " ");
}

const methods: Record<string, string> = {
  cash: "نقد",
  card: "کارت",
  transfer: "کارت به کارت",
  insurance: "بیمه",
};

// ابتدای امروز به وقت تهران (UTC+3:30 ثابت) به ثانیه — مبنای کارت «دریافتی امروز»
const TEHRAN_OFFSET_SEC = 3.5 * 3600;
function tehranDayStartSec(nowMs = Date.now()): number {
  const now = Math.floor(nowMs / 1000);
  return Math.floor((now + TEHRAN_OFFSET_SEC) / 86400) * 86400 - TEHRAN_OFFSET_SEC;
}

/** تاریخ (YYYY-MM-DD) و ساعت (ثانیه از نیمه‌شب) یک لحظه به وقت تهران */
function tehranDateParts(ms: number): { iso: string; secOfDay: number } {
  const t = new Date(ms + TEHRAN_OFFSET_SEC * 1000);
  return { iso: t.toISOString().slice(0, 10), secOfDay: t.getUTCHours() * 3600 + t.getUTCMinutes() * 60 };
}
/** لحظهٔ «روزِ iso در تهران + ثانیه از نیمه‌شب» به ثانیهٔ یونیکس */
function tehranSec(iso: string, secOfDay: number): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 1000 - TEHRAN_OFFSET_SEC + secOfDay;
}

const SERVICE_REMINDER_TYPES: Record<string, string> = {
  followup: "پیگیری دور بعدی خدمات",
  payment:  "یادآوری پرداخت",
};

interface ReceiptData {
  paymentId: number;
  paidAt: number;
  patientName?: string;
  serviceName?: string;
  sessionNumber?: number;
  unitsUsed?: number;
  unitLabel?: string;
  originalAmount: number;
  discountName?: string;
  discountAmount?: number;
  depositAmount?: number;
  walletAmount?: number;
  pointsAmount?: number;
  finalAmount: number;
  method: string;
  notes?: string;
}

// رسید از ردیف پرداختِ ذخیره‌شده در دیتابیس ساخته می‌شود تا جزئیات هر تراکنش
// دائمی، روی هر دستگاهی و در پشتیبان‌گیری در دسترس باشد (نه فقط در مرورگر)
function receiptFromPayment(p: {
  id: number; paidAt: number; originalAmount: number; amount: number; method: string;
  notes?: string | null; patientName?: string | null; serviceName?: string | null;
  sessionNumber?: number | null; unitsUsed?: number | null; unitLabel?: string | null;
  discountName?: string | null; discountAmount?: number | null; depositAmount?: number | null;
  walletAmount?: number | null; pointsAmount?: number | null;
}): ReceiptData {
  return {
    paymentId: p.id,
    paidAt: p.paidAt,
    patientName: p.patientName ?? undefined,
    serviceName: p.serviceName ?? undefined,
    sessionNumber: p.sessionNumber ?? undefined,
    unitsUsed: p.unitsUsed ?? undefined,
    unitLabel: p.unitLabel ?? undefined,
    originalAmount: p.originalAmount,
    discountName: p.discountName ?? undefined,
    discountAmount: p.discountAmount ?? undefined,
    depositAmount: p.depositAmount ?? undefined,
    walletAmount: p.walletAmount ?? undefined,
    pointsAmount: p.pointsAmount ?? undefined,
    finalAmount: p.amount,
    method: p.method,
    notes: p.notes ?? undefined,
  };
}

// ─── Receipt Dialog ────────────────────────────────────────────────────────────
// چاپ رسید: فقط بخش رسید چاپ می‌شود (بقیهٔ صفحه و پنجره در چاپ پنهان است)
const RECEIPT_PRINT_STYLE = `
@media print {
  body * { visibility: hidden !important; }
  #payment-receipt-print, #payment-receipt-print * { visibility: visible !important; }
  #payment-receipt-print {
    position: fixed !important; top: 0; right: 0; left: 0;
    margin: 0 auto; width: 80mm; max-width: 100%; padding: 4mm;
    background: #fff !important; color: #000 !important;
  }
  @page { margin: 6mm; }
}
`;

async function sendReceiptSms(paymentId: number): Promise<void> {
  await customFetch<{ ok: boolean }>(`/api/payments/${paymentId}/send-receipt`, { method: "POST" });
}

function ReceiptDialog({ receipt, open, onClose }: { receipt: ReceiptData | null; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  if (!receipt) return null;

  async function sendSms() {
    if (!receipt) return;
    setSending(true);
    try {
      await sendReceiptSms(receipt.paymentId);
      toast({ title: "پیامک رسید ارسال شد" });
    } catch (err) {
      toastApiError(err, "ارسال پیامک رسید ناموفق بود");
    } finally {
      setSending(false);
    }
  }

  const discountRow = receipt.discountAmount && receipt.discountAmount > 0;
  const depositRow  = receipt.depositAmount  && receipt.depositAmount  > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center text-lg">رسید پرداخت</DialogTitle>
        </DialogHeader>

        <style>{RECEIPT_PRINT_STYLE}</style>
        <div id="payment-receipt-print" className="space-y-4 font-vazirmatn" dir="rtl">
          {/* Header */}
          <div className="text-center border-b pb-3">
            <div className="font-bold text-base text-rose-800">مطب زیبایی دکتر یاری</div>
            <div className="text-xs text-muted-foreground mt-1">{formatShamsiDate(receipt.paidAt, true)}</div>
          </div>

          {/* Patient / Service */}
          {(receipt.patientName || receipt.serviceName) && (
            <div className="space-y-1 text-sm">
              {receipt.patientName && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">مراجع:</span>
                  <span className="font-medium">{receipt.patientName}</span>
                </div>
              )}
              {receipt.serviceName && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">خدمت:</span>
                  <span className="font-medium">
                    {receipt.serviceName}
                    {receipt.sessionNumber ? <span className="mr-1 text-indigo-600">(جلسه #{toPersianDigits(receipt.sessionNumber)})</span> : null}
                  </span>
                </div>
              )}
            </div>
          )}

          <Separator />

          {/* Amounts */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">مبلغ خدمت:</span>
              <span>{formatCurrency(receipt.originalAmount)}</span>
            </div>

            {receipt.unitsUsed && receipt.unitsUsed > 0 ? (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>واحد مصرفی:</span>
                <span>{toPersianDigits(receipt.unitsUsed)}{receipt.unitLabel ? ` ${receipt.unitLabel}` : ""}</span>
              </div>
            ) : null}

            {discountRow && (
              <div className="flex justify-between text-pink-700">
                <span>تخفیف{receipt.discountName ? ` (${receipt.discountName})` : ""}:</span>
                <span>− {formatCurrency(receipt.discountAmount)}</span>
              </div>
            )}

            {depositRow && (
              <div className="flex justify-between text-amber-700">
                <span>پرداخت‌شده قبلی (بیعانه/قسط):</span>
                <span>− {formatCurrency(receipt.depositAmount)}</span>
              </div>
            )}

            {!!receipt.pointsAmount && receipt.pointsAmount > 0 && (
              <div className="flex justify-between text-amber-700">
                <span>امتیاز باشگاه:</span>
                <span>− {formatCurrency(receipt.pointsAmount)}</span>
              </div>
            )}

            {!!receipt.walletAmount && receipt.walletAmount > 0 && (
              <div className="flex justify-between text-amber-700">
                <span>پرداخت از کیف پول:</span>
                <span>− {formatCurrency(receipt.walletAmount)}</span>
              </div>
            )}

            <Separator />

            <div className="flex justify-between font-bold text-base text-green-700">
              <span>مبلغ دریافت‌شده:</span>
              <span>{formatCurrency(receipt.finalAmount)}</span>
            </div>

            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">روش پرداخت:</span>
              <span>{methods[receipt.method] ?? receipt.method}</span>
            </div>

            {receipt.notes && (
              <div className="text-xs text-muted-foreground bg-muted rounded p-2 mt-1">
                {receipt.notes}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="text-center text-xs text-muted-foreground border-t pt-3">
            با تشکر از مراجعه شما
          </div>
        </div>

        <DialogFooter className="flex-row gap-2 sm:justify-between print:hidden">
          <Button variant="outline" className="flex-1 gap-1" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            چاپ
          </Button>
          <Button variant="outline" className="flex-1 gap-1" onClick={sendSms} disabled={sending}>
            <MessageSquare className="h-4 w-4" />
            {sending ? "در حال ارسال..." : "ارسال پیامک رسید"}
          </Button>
          <Button variant="secondary" onClick={onClose} className="flex-1">بستن</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Form schema ───────────────────────────────────────────────────────────────
const formSchema = z.object({
  appointmentId: z.coerce.number().optional(),
  unitsUsed: z.coerce.number().int().min(1).optional(),
  originalAmount: z.coerce.number().min(1, "مبلغ اصلی الزامی است"),
  amount: z.coerce.number().min(0),
  discountId: z.coerce.number().optional(),
  method: z.enum(["cash", "card", "transfer", "insurance"]),
  notes: z.string().optional(),
});

export default function Payments() {
  const { data: payments, isLoading, isError, refetch } = useListPayments();
  // همهٔ نوبت‌ها (نه فقط رزرو/تایید شده): نوبتی که دستی «تکمیل» شده ولی پرداخت نشده یا
  // مانده دارد هم باید قابل تسویه باشد
  const { data: apptList } = useListAppointments({ limit: 1000 });
  const allActiveAppointments = useMemo(
    () => (apptList?.data ?? []).filter(a => a.status !== "cancelled"),
    [apptList],
  );
  const { data: discounts } = useListDiscounts();
  const { data: staff } = useListStaff();
  const { data: recipients } = useListCommissionRecipients();
  const { data: patientsList } = useListPatients({ limit: 500 });
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [isOpen, setIsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);
  const [fullAmountChecked, setFullAmountChecked] = useState(false);
  // مبلغ کمتر از مانده: «تخفیف توافقی» (قیمت نهایی = مبلغ دریافتی) یا مانده به‌عنوان بدهی
  // باید صریحاً انتخاب شود (پیش‌فرض ندارد) تا کسری اشتباهی بدهی یا تخفیف ثبت نشود
  const [settleChoice, setSettleChoice] = useState<"discount" | "debt" | null>(null);
  const settleInFull = settleChoice === "discount";
  // جمع پرداخت‌های قبلیِ نوبت (بیعانه + اقساط قبلی؛ نقدی + کیف پول + امتیاز) — از سرور
  const [currentDeposit, setCurrentDeposit] = useState(0);

  // Commission state
  const [commissionEnabled, setCommissionEnabled] = useState(false);
  const [commRecipientType, setCommRecipientType] = useState<"staff" | "external" | "patient">("staff");
  const [commRecipientId, setCommRecipientId] = useState<number | null>(null);
  const [commCalcType, setCommCalcType] = useState<"percentage" | "fixed">("percentage");
  const [commCalcValue, setCommCalcValue] = useState<number>(0);

  // Discount state
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [selectedDiscountId, setSelectedDiscountId] = useState<number | null>(null);

  // باشگاه مشتریان: استفاده از امتیاز در این پرداخت
  const [redeemEnabled, setRedeemEnabled] = useState(false);
  const [redeemInput, setRedeemInput] = useState("");
  // کیف پول مراجع (اعتبار سود خدمت، هدیه‌ها و شارژ): استفاده در این پرداخت
  const [walletEnabled, setWalletEnabled] = useState(false);
  const [walletInput, setWalletInput] = useState("");

  // Receipt dialog state
  const [activeReceipt, setActiveReceipt] = useState<ReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  // Service reminder state
  const [svcReminderEnabled, setSvcReminderEnabled] = useState(false);
  const [svcReminderType, setSvcReminderType] = useState<"followup" | "payment">("followup");
  const [svcReminderDate, setSvcReminderDate] = useState("");

  // نوبت بعدی (اختیاری): پس از ثبت موفق پرداخت ساخته می‌شود
  const [nextAppt, setNextAppt] = useState<NextAppointmentValue>(EMPTY_NEXT_APPOINTMENT);
  const pendingNextApptRef = useRef<{ patientId: number; serviceId: number; staffId?: number; scheduledAt: number } | null>(null);
  const createAppointment = useCreateAppointment();

  // ویرایش پرداخت (فقط مدیر)
  const [editTarget, setEditTarget] = useState<Payment | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { amount: 0, originalAmount: 0, method: "cash", unitsUsed: 1 },
  });

  const originalAmount = useWatch({ control: form.control, name: "originalAmount" });
  const paidAmount = useWatch({ control: form.control, name: "amount" });
  const watchedAppointmentId = useWatch({ control: form.control, name: "appointmentId" });
  const unitsUsed = useWatch({ control: form.control, name: "unitsUsed" });
  const selectedAppt = useMemo(
    () => allActiveAppointments.find(a => a.id === watchedAppointmentId) ?? null,
    [allActiveAppointments, watchedAppointmentId],
  );
  const isPerUnit = selectedAppt?.priceMode === "per_unit";
  const selectedPatientId = ((selectedAppt as any)?.patientId ?? null) as number | null;
  const selectedPatientRow = useMemo(
    () => patientsList?.data?.find(p => p.id === selectedPatientId) ?? null,
    [patientsList, selectedPatientId],
  );
  // نوبتی که قبلاً پرداخت تسویه (غیر از بیعانه) داشته: مبلغ اصلی = قیمت ثبت‌شدهٔ نوبت
  const isFollowupPayment = !!selectedAppt?.hasCheckoutPayment && selectedAppt?.price != null;

  // وضعیت باشگاه مراجعِ نوبت انتخاب‌شده
  const { data: patientLoyalty } = useGetPatientLoyalty(selectedPatientId ?? 0, {
    query: { enabled: !!selectedPatientId, queryKey: getGetPatientLoyaltyQueryKey(selectedPatientId ?? 0) },
  });
  const loyaltyOn = !!patientLoyalty?.settings?.enabled;
  const loyaltyBalance = patientLoyalty?.balance ?? 0;
  const pointValue = patientLoyalty?.settings?.redeemValue ?? 0;
  const walletBalance = patientLoyalty?.walletBalance ?? 0;

  // وقتی نوبت انتخاب می‌شه: واحد مصرفی پیش‌فرض و مبلغ اصلی را تنظیم کن و پرداخت‌های قبلی را ذخیره کن
  // (پرداخت‌های واقعیِ ثبت‌شده، نه appointments.deposit — اگر بیعانه حذف شده باشد دیگر کسر نمی‌شود)
  // تاریخ پرداخت: برای خدمتی که روزهای قبل انجام شده، پیش‌فرض روز خدمت است تا درآمد و سود
  // در ماه خودش حساب شود (نه ماهی که در صندوق ثبت می‌شود)
  const todayIso = tehranDateParts(Date.now()).iso;
  const [payDate, setPayDate] = useState<string>(todayIso);
  const apptDay = selectedAppt ? tehranDateParts(selectedAppt.scheduledAt) : null;
  useEffect(() => {
    if (!selectedAppt) { setPayDate(tehranDateParts(Date.now()).iso); return; }
    const today = tehranDateParts(Date.now()).iso;
    const day = tehranDateParts(selectedAppt.scheduledAt).iso;
    setPayDate(day < today ? day : today);
  }, [selectedAppt]);
  function paidAtForSubmit(): number | undefined {
    if (!payDate || payDate >= todayIso) return undefined; // امروز ← زمان ثبت
    const secOfDay = apptDay && apptDay.iso === payDate ? apptDay.secOfDay : 12 * 3600;
    return tehranSec(payDate, secOfDay);
  }

  useEffect(() => {
    if (!selectedAppt) {
      setCurrentDeposit(0);
      return;
    }
    const previous = selectedAppt.paidTotal ?? 0;
    setCurrentDeposit(previous);
    if (selectedAppt.hasCheckoutPayment && selectedAppt.price != null) {
      // پرداخت بعدیِ نوبتی که قبلاً بخشی از آن پرداخت شده: مبلغ اصلی = قیمت خالص نوبت
      form.setValue("unitsUsed", selectedAppt.unitsUsed ?? 1);
      form.setValue("originalAmount", selectedAppt.price);
      setDiscountEnabled(false);
      setSelectedDiscountId(null);
    } else if (selectedAppt.priceMode === "per_unit") {
      const u = selectedAppt.unitsUsed ?? selectedAppt.serviceUnitCount ?? 1;
      form.setValue("unitsUsed", u);
      form.setValue("originalAmount", (selectedAppt.unitPrice ?? 0) * u);
    } else {
      form.setValue("unitsUsed", 1);
      form.setValue("originalAmount", selectedAppt.servicePrice ?? 0);
    }
    if (previous > 0) {
      form.setValue("notes", `مراجع مبلغ ${previous.toLocaleString()} تومان قبلاً برای این نوبت پرداخت کرده و از مبلغ نهایی کسر می‌شود`);
    } else {
      form.setValue("notes", "");
    }
  }, [selectedAppt]);

  // ساعت پیش‌فرض نوبت بعدی = ساعت همین نوبت (به وقت تهران)
  useEffect(() => {
    setNextAppt((v) => ({ ...v, time: selectedAppt ? tehranHHMM(selectedAppt.scheduledAt) : "" }));
  }, [selectedAppt]);

  // با تغییر واحد مصرفی، مبلغ اصلی خدمات per_unit بازمحاسبه می‌شود
  useEffect(() => {
    if (!selectedAppt || selectedAppt.priceMode !== "per_unit" || isFollowupPayment) return;
    const u = unitsUsed && unitsUsed > 0 ? unitsUsed : 1;
    form.setValue("originalAmount", (selectedAppt.unitPrice ?? 0) * u);
  }, [unitsUsed, selectedAppt]);

  const selectedDiscount = useMemo(
    () => discounts?.find(d => d.id === selectedDiscountId) ?? null,
    [discounts, selectedDiscountId]
  );

  // مبلغ پس از تخفیف
  const afterDiscount = useMemo(() => {
    const base = originalAmount || 0;
    if (!(discountEnabled && selectedDiscount)) return base;
    return selectedDiscount.type === "percentage"
      ? Math.round(base * (1 - selectedDiscount.value / 100))
      : Math.max(0, base - selectedDiscount.value);
  }, [discountEnabled, selectedDiscount, originalAmount]);

  // امتیاز باشگاه: حداکثر به اندازهٔ موجودی و مبلغ باقی‌مانده (پس از تخفیف و بیعانه)
  const dueBeforePoints = Math.max(0, afterDiscount - currentDeposit);
  const maxRedeemPoints = loyaltyOn && pointValue > 0
    ? Math.min(loyaltyBalance, Math.floor(dueBeforePoints / pointValue))
    : 0;
  const redeemPoints = redeemEnabled
    ? Math.min(Math.max(0, Number.parseInt(redeemInput || "0", 10) || 0), maxRedeemPoints)
    : 0;
  const redeemToman = redeemPoints * pointValue;

  // کیف پول: حداکثر به اندازهٔ موجودی و مبلغ باقی‌مانده پس از امتیاز
  const maxWallet = Math.max(0, Math.min(walletBalance, dueBeforePoints - redeemToman));
  const walletApplied = walletEnabled
    ? Math.min(Math.max(0, Number.parseInt(walletInput || "0", 10) || 0), maxWallet)
    : 0;

  useEffect(() => {
    form.setValue("discountId", discountEnabled && selectedDiscount ? selectedDiscount.id : undefined);
  }, [discountEnabled, selectedDiscount]);

  // مبلغ پرداختی (نقدی) = پس از تخفیف − بیعانه − ارزش امتیاز − مبلغ پرداخت‌شده از کیف پول
  // (با تغییر هر کدام، یا وقتی «مبلغ کامل» تیک می‌خورد، دوباره حساب می‌شود)
  useEffect(() => {
    form.setValue("amount", Math.max(0, dueBeforePoints - redeemToman - walletApplied));
  }, [dueBeforePoints, redeemToman, walletApplied, fullAmountChecked]);

  // کسریِ مبلغ دریافتی نسبت به مانده (برای انتخاب «تخفیف توافقی» یا «بدهی»)
  const shortfall = Math.max(0, dueBeforePoints - redeemToman - walletApplied - (Number(paidAmount) || 0));

  const commissionAmount = useMemo(() => {
    const base = paidAmount || 0;
    if (commCalcType === "percentage") return Math.round(base * commCalcValue / 100);
    return commCalcValue;
  }, [commCalcType, commCalcValue, paidAmount]);

  // پورسانت خودکار معرفِ مراجع (کارمند/کمیسیون‌گیرنده/لیزر) که سرور همراه همین پرداخت ثبت می‌کند
  const autoReferrer = useMemo(() => {
    const p = selectedPatientRow;
    if (!p?.referrerType || p.referrerType === "patient" || !p.referrerId || !p.referrerRate || p.referrerRate <= 0) return null;
    return {
      recipientType: (p.referrerType === "staff" ? "staff" : "external") as "staff" | "external",
      recipientId: p.referrerId,
      name: p.referrerName ?? "معرف",
      rate: p.referrerRate,
      amount: Math.round(((paidAmount || 0) * p.referrerRate) / 100),
    };
  }, [selectedPatientRow, paidAmount]);
  // اعتبار معرفی باشگاه برای معرفِ «مراجع» خودکار است؛ گزینهٔ دستی «مراجع» پنهان می‌شود
  const loyaltyReferralAuto = loyaltyOn && (patientLoyalty?.settings?.referralBonus ?? 0) > 0;
  const duplicateOfAuto = !!autoReferrer && commissionEnabled && commRecipientType === autoReferrer.recipientType && commRecipientId === autoReferrer.recipientId;

  const createPayment = useCreatePayment({
    mutation: {
      onSuccess: (payment) => {
        queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
        // امتیاز و سطح باشگاه مراجع عوض شده است
        if (selectedPatientId) queryClient.invalidateQueries({ queryKey: getGetPatientLoyaltyQueryKey(selectedPatientId) });

        // وضعیت نوبت (تکمیل فقط با پرداخت کامل)، کمیسیون دستی/اعتبار معرفی و یادآوری
        // همگی سمت سرور و داخل تراکنشِ همین پرداخت ثبت شده‌اند؛ فقط کش‌ها تازه می‌شوند
        queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListCommissionsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListRemindersQueryKey() });
        if (selectedPatientId) queryClient.invalidateQueries({ queryKey: getListPatientAppointmentsQueryKey(selectedPatientId) });
        if (commissionEnabled && commRecipientType === "patient" && commRecipientId) {
          queryClient.invalidateQueries({ queryKey: getGetPatientQueryKey(commRecipientId) });
          queryClient.invalidateQueries({ queryKey: getListPatientAccountTransactionsQueryKey(commRecipientId) });
        }

        // کسر موجودی اکانت اکنون سمت سرور و اتمیک با ثبت پرداخت انجام می‌شود
        // پس فقط کش مربوط به موجودی/تراکنش‌های مراجع را تازه می‌کنیم
        if (selectedPatientId) {
          queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetPatientQueryKey(selectedPatientId) });
          queryClient.invalidateQueries({ queryKey: getListPatientAccountTransactionsQueryKey(selectedPatientId) });
        }

        // رسید از ردیف پرداختِ ذخیره‌شده در دیتابیس ساخته می‌شود (جزئیات کامل و دائمی)
        const receipt = receiptFromPayment(payment);

        setIsOpen(false);
        resetDialog();
        // نمایش رسید پس از ثبت موفق
        setActiveReceipt(receipt);
        setReceiptOpen(true);
        toast({ title: "پرداخت با موفقیت ثبت شد" });

        // نوبت بعدی: خطای آن ثبت پرداخت را مختل نمی‌کند
        const plan = pendingNextApptRef.current;
        pendingNextApptRef.current = null;
        if (plan) {
          createAppointment.mutateAsync({ data: plan })
            .then(() => {
              queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
              queryClient.invalidateQueries({ queryKey: getListPatientAppointmentsQueryKey(plan.patientId) });
              toast({ title: "نوبت بعدی ثبت شد", description: formatShamsiDate(plan.scheduledAt, true) });
            })
            .catch((err) => toastApiError(err, "پرداخت ثبت شد ولی ثبت نوبت بعدی ناموفق بود"));
        }
      },
      onError: (error) => {
        pendingNextApptRef.current = null;
        // پیام خطای سرور (فارسی) را نمایش می‌دهیم تا رد شدن پرداخت کیف پول
        // برای اپراتور قابل فهم باشد (به‌ویژه «موجودی اکانت کافی نیست»).
        const serverMessage =
          (error as any)?.data?.error ??
          (error as any)?.data?.message;
        toast({
          title: "ثبت پرداخت ناموفق بود",
          description:
            typeof serverMessage === "string" && serverMessage.trim()
              ? serverMessage
              : "ثبت پرداخت با خطا مواجه شد. لطفاً دوباره تلاش کنید.",
          variant: "destructive",
        });
      },
    },
  });

  const deletePayment = useDeletePayment({
    mutation: {
      onSuccess: () => {
        // حذف پرداخت درآمد، وضعیت نوبت، کمیسیون‌ها، کیف پول، باشگاه، حسابداری و داشبورد را تغییر
        // می‌دهد؛ همهٔ داده‌ها دوباره خوانده می‌شوند تا هیچ عددی از حافظه نماند
        queryClient.invalidateQueries();
        toast({ title: "پرداخت حذف شد" });
      },
      // پیام خطای سرور (مثلاً «پورسانت این پرداخت تسویه شده است…») نمایش داده می‌شود
      onError: onApiError("حذف پرداخت ناموفق بود"),
    },
  });

  function resetDialog() {
    form.reset({ amount: 0, originalAmount: 0, method: "cash", unitsUsed: 1 });
    setFullAmountChecked(false);
    setSettleChoice(null);
    setCurrentDeposit(0);
    setCommissionEnabled(false);
    setCommRecipientType("staff");
    setCommRecipientId(null);
    setCommCalcType("percentage");
    setCommCalcValue(0);
    setDiscountEnabled(false);
    setSelectedDiscountId(null);
    setSvcReminderEnabled(false);
    setSvcReminderType("followup");
    setSvcReminderDate("");
    setRedeemEnabled(false);
    setRedeemInput("");
    setWalletEnabled(false);
    setWalletInput("");
    setNextAppt(EMPTY_NEXT_APPOINTMENT);
  }

  function onSubmit(values: z.infer<typeof formSchema>) {
    const appt = selectedAppt;
    const minRedeem = patientLoyalty?.settings.minRedeem ?? 1;
    if (redeemPoints > 0 && redeemPoints < minRedeem) {
      toast({ title: `حداقل امتیاز قابل استفاده ${toPersianDigits(minRedeem)} است`, variant: "destructive" });
      return;
    }
    // مبلغ دریافتی صفر فقط وقتی مجاز است که کل مبلغ با بیعانه/کیف پول/امتیاز پوشش داده شده باشد
    // مبلغ کمتر از مانده: باید مشخص شود تخفیف توافقی است یا بدهی
    if (shortfall > 0 && settleChoice === null) {
      toast({ title: "مشخص کنید مبلغ باقی‌مانده «تخفیف توافقی» است یا «بدهی مراجع»", variant: "destructive" });
      return;
    }
    // مبلغ صفر فقط وقتی مجاز است که بقیه پوشش داده شده یا کل مانده تخفیف توافقی است
    if (!(values.amount > 0) && dueBeforePoints - redeemToman - walletApplied > 0 && !settleInFull) {
      toast({ title: "مبلغ دریافتی را وارد کنید", variant: "destructive" });
      return;
    }
    if (duplicateOfAuto) {
      toast({ title: "برای معرفِ این مراجع پورسانت خودکار ثبت می‌شود؛ کمیسیون دستی تکراری مجاز نیست", variant: "destructive" });
      return;
    }
    if (svcReminderEnabled && !svcReminderDate) {
      toast({ title: "تاریخ یادآوری را انتخاب کنید", variant: "destructive" });
      return;
    }
    // نوبت بعدی: همان مراجع، خدمت و پرسنلِ نوبت فعلی
    pendingNextApptRef.current = null;
    if (nextAppt.enabled && appt) {
      const scheduledAt = nextAppointmentMs(nextAppt);
      if (!scheduledAt) {
        toast({ title: "تاریخ و ساعت نوبت بعدی را کامل وارد کنید", variant: "destructive" });
        return;
      }
      if (scheduledAt <= Date.now()) {
        toast({ title: "زمان نوبت بعدی باید در آینده باشد", variant: "destructive" });
        return;
      }
      pendingNextApptRef.current = {
        patientId: appt.patientId,
        serviceId: appt.serviceId,
        staffId: appt.staffId ?? undefined,
        scheduledAt,
      };
    }
    // مبلغ تخفیف اعمال‌شده تا روی ردیف پرداخت ذخیره و در رسید نمایش داده شود
    const discountAmt = discountEnabled && selectedDiscount
      ? selectedDiscount.type === "percentage"
        ? Math.round((values.originalAmount || 0) * selectedDiscount.value / 100)
        : Math.min(selectedDiscount.value, values.originalAmount || 0)
      : 0;
    createPayment.mutate({
      data: {
        ...values,
        ...(paidAtForSubmit() ? { paidAt: paidAtForSubmit() } : {}),
        originalAmount: values.originalAmount,
        // مبلغ نقدی همان است که محاسبه شده؛ صفر یعنی بقیه با بیعانه/کیف پول/امتیاز پوشش داده شده
        amount: values.amount ?? 0,
        appointmentId: values.appointmentId ?? 0,
        unitsUsed: isPerUnit ? (values.unitsUsed ?? 1) : undefined,
        // اسنپ‌شات جزئیات تا هر پرداخت به‌صورت کامل و دائمی در دیتابیس بماند
        patientName: appt?.patientName ?? undefined,
        serviceName: appt?.serviceName ?? undefined,
        sessionNumber: (appt as any)?.sessionNumber ?? undefined,
        unitLabel: appt?.unitLabel ?? undefined,
        discountName: discountEnabled && selectedDiscount ? selectedDiscount.name : undefined,
        discountAmount: discountAmt > 0 ? discountAmt : undefined,
        depositAmount: currentDeposit > 0 ? currentDeposit : undefined,
        redeemPoints: redeemPoints > 0 ? redeemPoints : undefined,
        // سرور همین مبلغ را در همان تراکنش از کیف پول کم می‌کند
        applyAccountBalance: walletApplied > 0 ? walletApplied : undefined,
        settleInFull: shortfall > 0 && settleInFull ? true : undefined,
        // کمیسیون دستی / اعتبار معرفی و یادآوری پیگیری — داخل تراکنش همین پرداخت در سرور
        manualCommission: commissionEnabled && commRecipientId && commissionAmount > 0
          ? {
              recipientType: commRecipientType,
              recipientId: commRecipientId,
              amount: commissionAmount,
              rate: commCalcType === "percentage" ? commCalcValue : undefined,
              description: commRecipientType === "patient" ? undefined : commissionDescription(),
            }
          : undefined,
        // مقدار PersianDatePicker رشتهٔ میلادی YYYY-MM-DD است
        reminder: svcReminderEnabled && svcReminderDate
          ? { type: svcReminderType, dueDate: svcReminderDate }
          : undefined,
      },
    });
  }

  function commissionDescription(): string | undefined {
    const recipientName =
      commRecipientType === "staff"
        ? staff?.find(s => s.id === commRecipientId)?.name
        : recipients?.find(r => r.id === commRecipientId)?.name;
    const desc = [
      selectedAppt?.serviceName,
      commCalcType === "percentage" ? `${toPersianDigits(commCalcValue)}٪` : null,
      `${formatCurrency(commissionAmount)}`,
      recipientName ? `${recipientName} (${commRecipientType === "staff" ? "پرسنل" : "خارجی"})` : null,
    ].filter(Boolean).join(" — ");
    return desc || undefined;
  }

  const prefetchPayment = useCallback((id: number) => {
    queryClient.prefetchQuery({ ...getGetPaymentQueryOptions(id), staleTime: 30_000 });
  }, [queryClient]);

  // رسید از رکورد اختصاصیِ همان پرداخت ساخته می‌شود (getPayment) تا جزئیاتِ
  // تکمیل‌شده روی سرور همیشه نمایش داده شود. اگر هاور روی ردیف کش را گرم کرده باشد
  // نمایش آنی است؛ در غیر این صورت یک‌بار واکشی می‌شود و در صورت خطا به دادهٔ
  // ردیفِ فهرست برمی‌گردیم تا رسید همیشه باز شود.
  async function openReceiptForPayment(paymentId: number) {
    try {
      const payment = await queryClient.ensureQueryData({
        ...getGetPaymentQueryOptions(paymentId),
        staleTime: 30_000,
      });
      setActiveReceipt(receiptFromPayment(payment));
      setReceiptOpen(true);
      return;
    } catch {
      const p = payments?.find(x => x.id === paymentId);
      if (!p) {
        toast({ title: "تراکنش یافت نشد", variant: "destructive" });
        return;
      }
      // واکشی رکورد کامل پرداخت ناموفق بود؛ رسید از دادهٔ ردیفِ فهرست ساخته می‌شود
      // و ممکن است برخی جزئیاتِ تکمیل‌شده روی سرور را نداشته باشد.
      setActiveReceipt(receiptFromPayment(p));
      setReceiptOpen(true);
      toast({
        title: "رسید با اطلاعات محلی نمایش داده شد",
        description: "دریافت جزئیات کامل پرداخت از سرور ناموفق بود؛ ممکن است برخی اطلاعات کامل نباشد.",
      });
    }
  }

  // ابتدای روز به وقت تهران (نه نیمه‌شب UTC)
  const todayStart = tehranDayStartSec();
  const totalToday = payments?.reduce((sum, p) => (p.paidAt >= todayStart ? sum + p.amount : sum), 0) ?? 0;

  // پرداخت احتمالاً تکراری: همان مراجع + همان خدمت + همان مبلغ در فاصلهٔ ۷ روز
  // (مثلاً پرداختی که حذف نشده و دوباره ثبت شده)
  const [onlyDuplicates, setOnlyDuplicates] = useState(false);
  const duplicateIds = useMemo(() => {
    const ids = new Set<number>();
    const groups = new Map<string, NonNullable<typeof payments>>();
    for (const p of payments ?? []) {
      const name = (p as any).patientName as string | null | undefined;
      if (!name || !(p.amount > 0)) continue;
      const key = `${name}|${(p as any).serviceName ?? ""}|${p.amount}`;
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    for (const list of groups.values()) {
      const sorted = [...list].sort((a, b) => a.paidAt - b.paidAt);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].paidAt - sorted[i - 1].paidAt <= 7 * 86400) { ids.add(sorted[i].id); ids.add(sorted[i - 1].id); }
      }
    }
    return ids;
  }, [payments]);
  // جست‌وجو و فیلتر (مراجع/خدمت/یادداشت، روش، بازهٔ تاریخ)
  const [searchText, setSearchText] = useState("");
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  const dateRange = useMemo<DateRange | null>(
    () => (datePreset === "all" ? null : datePreset === "custom" ? customRange : presetRange(datePreset)),
    [datePreset, customRange],
  );
  const filteredPayments = useMemo(() => {
    const q = normalizeSearch(searchText);
    return (payments ?? []).filter((p) => {
      if (methodFilter !== "all" && p.method !== methodFilter) return false;
      if (dateRange && (p.paidAt < dateRange.from || p.paidAt >= dateRange.to)) return false;
      if (q) {
        const hay = normalizeSearch([p.patientName, p.serviceName, p.notes].filter(Boolean).join(" "));
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [payments, searchText, methodFilter, dateRange]);
  // پرداختی که در ماهی (شمسی) غیر از ماه خدمت ثبت شده — مثلاً خدمت شهریور که مهر در صندوق ثبت شده؛
  // درآمد و سودش در ماه اشتباه حساب می‌شود. مدیر با یک کلیک آن را به روز خدمت منتقل می‌کند.
  const [onlyWrongMonth, setOnlyWrongMonth] = useState(false);
  const wrongMonthIds = useMemo(() => {
    const monthKey = new Intl.DateTimeFormat("en-u-ca-persian", { year: "numeric", month: "numeric", timeZone: "Asia/Tehran" });
    const ids = new Set<number>();
    for (const p of payments ?? []) {
      const svc = (p as { serviceScheduledAt?: number | null }).serviceScheduledAt;
      if (!svc) continue;
      const svcSec = svc > 1e11 ? Math.floor(svc / 1000) : svc;
      if (p.paidAt - svcSec < 86400) continue; // پرداخت قبل از خدمت (بیعانه) یا همان روز
      if (monthKey.format(new Date(svcSec * 1000)) !== monthKey.format(new Date(p.paidAt * 1000))) ids.add(p.id);
    }
    return ids;
  }, [payments]);
  const [movingId, setMovingId] = useState<number | null>(null);
  async function moveToServiceDate(p: { id: number; paidAt: number; serviceScheduledAt?: number | null }) {
    if (!p.serviceScheduledAt) return;
    const svcSec = p.serviceScheduledAt > 1e11 ? Math.floor(p.serviceScheduledAt / 1000) : p.serviceScheduledAt;
    setMovingId(p.id);
    try {
      await customFetch(`/api/payments/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidAt: svcSec }),
      });
      await queryClient.invalidateQueries();
      toast({ title: "پرداخت به تاریخ خدمت منتقل شد", description: formatShamsiDate(svcSec) });
    } catch (err) {
      toastApiError(err, "انتقال ناموفق بود");
    } finally {
      setMovingId(null);
    }
  }

  const visiblePayments = useMemo(
    () => filteredPayments
      .filter((p) => !onlyDuplicates || duplicateIds.has(p.id))
      .filter((p) => !onlyWrongMonth || wrongMonthIds.has(p.id)),
    [filteredPayments, onlyDuplicates, duplicateIds, onlyWrongMonth, wrongMonthIds],
  );
  const visibleTotal = useMemo(() => visiblePayments.reduce((sum, p) => sum + p.amount, 0), [visiblePayments]);
  const filtersActive = !!searchText.trim() || methodFilter !== "all" || datePreset !== "all" || onlyDuplicates;

  const paymentSort = useTableSort(visiblePayments, {
    paidAt: (p) => p.paidAt,
    patient: (p) => (p as any).patientName,
    service: (p) => (p as any).serviceName,
    amount: (p) => p.amount,
    originalAmount: (p) => (p.originalAmount !== p.amount ? p.originalAmount : null),
    method: (p) => methods[p.method] ?? p.method,
    notes: (p) => p.notes,
  });

  const activeDiscounts = discounts?.filter(d => d.isActive) ?? [];

  // نوبت‌های لغونشده‌ای که هنوز پرداخت تسویه ندارند یا مانده دارند (پرداخت قسطی)
  // پرداخت بیعانه نوبت را «پرداخت‌شده کامل» نمی‌کند
  const unpaidAppointments = allActiveAppointments.filter(
    a => !a.hasCheckoutPayment || (a.remaining ?? 0) > 0
  );

  function exportFiltered() {
    exportCsv(`صندوق-${new Date().toISOString().slice(0, 10)}`, [
      { header: "تاریخ", value: (p) => csvDate(p.paidAt) },
      { header: "مراجع", value: (p) => p.patientName ?? "" },
      { header: "خدمت", value: (p) => p.serviceName ?? "" },
      { header: "جلسه", value: (p) => p.sessionNumber ?? "" },
      { header: "مبلغ دریافتی", value: (p) => p.amount },
      { header: "مبلغ اصلی", value: (p) => p.originalAmount },
      { header: "تخفیف", value: (p) => p.discountAmount ?? "" },
      { header: "کیف پول", value: (p) => p.walletAmount ?? "" },
      { header: "روش", value: (p) => methods[p.method] ?? p.method },
      { header: "یادداشت", value: (p) => p.notes ?? "" },
    ], paymentSort.sorted);
  }

  // ‎/payments?appointmentId=123 (مثلاً از پروندهٔ مراجع): پنجرهٔ ثبت پرداخت با همان نوبت باز می‌شود
  const urlSearch = useSearch();
  const [location, setLocation] = useLocation();
  useEffect(() => {
    const raw = new URLSearchParams(urlSearch).get("appointmentId");
    if (!raw || !apptList) return;
    const id = Number(raw);
    if (Number.isInteger(id) && id > 0 && unpaidAppointments.some((a) => a.id === id)) {
      resetDialog();
      form.setValue("appointmentId", id);
      setIsOpen(true);
    } else {
      toast({ title: "این نوبت در فهرست نوبت‌های قابل پرداخت نیست", description: "ممکن است قبلاً تسویه یا لغو شده باشد.", variant: "destructive" });
    }
    // پارامتر پاک می‌شود تا با تازه‌سازی صفحه دوباره باز نشود
    setLocation(location, { replace: true });
  }, [urlSearch, apptList]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<CreditCard />}
        title="صندوق"
        description="مدیریت پرداخت‌ها و دریافت‌ها"
        actions={<>
          <Button className="gap-2" onClick={() => { resetDialog(); setIsOpen(true); }}>
          <Plus className="h-4 w-4" />
          ثبت پرداخت
          </Button>
        </>}
      />

      {isError && <ErrorNotice onRetry={() => refetch()} />}

      <div className="grid gap-4 md:grid-cols-2">
        <StatCard tone="rose" title="دریافتی امروز" value={formatCurrency(totalToday)} icon={<Banknote />} />
        <StatCard tone="wine" title="کل تراکنش‌ها" value={<>{toPersianDigits(payments?.length ?? 0)} تراکنش</>} icon={<CreditCard />} />
      </div>

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        title={`حذف ${deleteTarget?.label ?? ''}`}
        description={`آیا از حذف «${deleteTarget?.label ?? ''}» مطمئن هستید؟ این عمل قابل بازگشت نیست.`}
        onConfirm={() => { deletePayment.mutate({ id: deleteTarget!.id }); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* ─── Edit Payment Dialog (admin) ─────────────────────────────── */}
      <PaymentEditDialog
        payment={editTarget}
        open={!!editTarget}
        onOpenChange={(o) => { if (!o) setEditTarget(null); }}
      />

      {/* ─── Receipt Dialog ──────────────────────────────────────────── */}
      <ReceiptDialog
        receipt={activeReceipt}
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
      />

      {/* ─── New Payment Dialog ──────────────────────────────────────── */}
      <Dialog open={isOpen} onOpenChange={(o) => { if (!o) resetDialog(); setIsOpen(o); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>ثبت پرداخت جدید</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 items-start">
            <div className="space-y-3 min-w-0">

              {/* Appointment */}
              <FormField control={form.control} name="appointmentId" render={({ field }) => (
                <FormItem>
                  <FormLabel>نوبت مرتبط (اختیاری)</FormLabel>
                  <Select onValueChange={(v) => field.onChange(v === "none" ? undefined : Number(v))} value={field.value ? String(field.value) : "none"}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="انتخاب نوبت..." /></SelectTrigger>
                    </FormControl>
                    <SelectContent className="max-w-[var(--radix-select-trigger-width)]">
                      <SelectItem value="none">بدون نوبت</SelectItem>
                      {unpaidAppointments.map(a => {
                        const paid = a.paidTotal ?? 0;
                        const apptCode = a.appointmentCode;
                        const dateStr = formatShamsiDate(a.scheduledAt);
                        return (
                          <SelectItem key={a.id} value={String(a.id)}>
                            <span className="block truncate">
                              {apptCode ? `${apptCode} — ` : ""}{a.patientName} — {a.serviceName} — {dateStr}
                              {a.hasCheckoutPayment && (a.remaining ?? 0) > 0
                                ? ` (مانده: ${a.remaining!.toLocaleString()} تومان)`
                                : paid > 0 ? ` (پرداخت‌شده: ${paid.toLocaleString()} تومان)` : ""}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              {/* پرداخت‌های قبلی و مانده (بیعانه یا قسط قبلی) */}
              {selectedAppt && currentDeposit > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50/60 p-2 text-sm space-y-1" data-testid="previous-payments">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">پرداخت‌شده قبلی:</span>
                    <span className="font-medium">{formatCurrency(currentDeposit)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">مانده:</span>
                    <span className="font-bold text-amber-800">{formatCurrency(Math.max(0, afterDiscount - currentDeposit))}</span>
                  </div>
                </div>
              )}

              {/* Units used (per-unit priced services only) */}
              {isPerUnit && !isFollowupPayment && (
                <FormField control={form.control} name="unitsUsed" render={({ field }) => (
                  <FormItem>
                    <FormLabel>واحد مورد استفاده{selectedAppt?.unitLabel ? ` (${selectedAppt.unitLabel})` : ""}</FormLabel>
                    <FormControl><Input type="number" dir="ltr" min={1} {...field} value={field.value ?? 1} /></FormControl>
                    <p className="text-xs text-muted-foreground">
                      {toPersianDigits(unitsUsed || 1)}{selectedAppt?.unitLabel ? ` ${selectedAppt.unitLabel}` : ""} × {formatCurrency(selectedAppt?.unitPrice ?? 0)} = <span className="font-medium text-foreground">{formatCurrency((selectedAppt?.unitPrice ?? 0) * (unitsUsed || 1))}</span>
                    </p>
                    <FormMessage />
                  </FormItem>
                )} />
              )}

              {/* Amounts */}
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="originalAmount" render={({ field }) => (
                  <FormItem>
                    <FormLabel>مبلغ اصلی (تومان)</FormLabel>
                    <FormControl><Input type="number" dir="ltr" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between mb-1">
                      <FormLabel className="mb-0">مبلغ دریافتی (تومان)</FormLabel>
                      <div className="flex items-center gap-1.5">
                        <Checkbox
                          id="full-amount-check"
                          checked={fullAmountChecked}
                          onCheckedChange={(v) => setFullAmountChecked(Boolean(v))}
                        />
                        <label htmlFor="full-amount-check" className="text-xs text-muted-foreground cursor-pointer select-none">
                          مبلغ کامل
                        </label>
                      </div>
                    </div>
                    <FormControl>
                      <Input
                        type="number"
                        dir="ltr"
                        {...field}
                        readOnly={fullAmountChecked || (discountEnabled && !!selectedDiscount)}
                        className={(fullAmountChecked || (discountEnabled && !!selectedDiscount)) ? "bg-muted cursor-not-allowed" : ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {shortfall > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2 text-sm">
                  <div className="text-amber-900">
                    مبلغ دریافتی <span className="font-bold">{formatCurrency(shortfall)}</span> کمتر از مانده است. این مبلغ:
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant={settleChoice === "discount" ? "default" : "outline"} onClick={() => setSettleChoice("discount")}>
                      تخفیف توافقی است (تسویه کامل)
                    </Button>
                    <Button type="button" size="sm" variant={settleChoice === "debt" ? "default" : "outline"} onClick={() => setSettleChoice("debt")}>
                      بدهی مراجع است (بعداً پرداخت می‌شود)
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {settleChoice === "discount"
                      ? "قیمت نهایی خدمت همین مبلغ دریافتی ثبت می‌شود و سود هم از همین مبلغ حساب می‌شود."
                      : settleChoice === "debt"
                        ? "مانده به‌عنوان بدهی در صندوق و پروندهٔ مراجع می‌ماند و بعداً از همین صندوق دریافت می‌شود."
                        : "برای ثبت پرداخت، یکی از دو گزینه را انتخاب کنید."}
                  </p>
                </div>
              )}

              {/* تاریخ پرداخت */}
              <div className="space-y-1.5">
                <Label className="text-sm">تاریخ پرداخت</Label>
                <PersianDatePicker value={payDate} onChange={(v) => setPayDate(v && v <= todayIso ? v : todayIso)} placeholder="امروز" />
                {apptDay && apptDay.iso < todayIso && (
                  <p className={cn("text-xs rounded-lg px-2 py-1", payDate === apptDay.iso ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800")} data-testid="past-service-date-note">
                    {payDate === apptDay.iso
                      ? `این خدمت در ${formatShamsiDate(selectedAppt!.scheduledAt)} انجام شده؛ درآمد و سود آن در همان تاریخ ثبت می‌شود.`
                      : `خدمت در ${formatShamsiDate(selectedAppt!.scheduledAt)} انجام شده ولی پرداخت با تاریخ دیگری ثبت می‌شود و در ماه همان تاریخ حساب می‌شود.`}
                  </p>
                )}
              </div>

              {/* Method */}
              <FormField control={form.control} name="method" render={({ field }) => (
                <FormItem>
                  <FormLabel>روش پرداخت</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(methods).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Notes */}
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>یادداشت</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

            </div>

            <div className="space-y-3 min-w-0">

              {/* Service Reminder Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2 font-medium cursor-pointer" htmlFor="svc-reminder-toggle">
                    <Bell className="h-4 w-4 text-pink-600" />
                    یادآوری خدمات
                  </Label>
                  <Switch
                    id="svc-reminder-toggle"
                    checked={svcReminderEnabled}
                    onCheckedChange={(v) => {
                      setSvcReminderEnabled(v);
                      if (!v) { setSvcReminderDate(""); }
                    }}
                  />
                </div>

                {svcReminderEnabled && (
                  <div className="space-y-3 rounded-lg border border-pink-200 p-3 bg-pink-50/40">
                    <div>
                      <Label className="text-sm mb-1.5 block">نوع یادآوری</Label>
                      <Select
                        value={svcReminderType}
                        onValueChange={(v) => setSvcReminderType(v as "followup" | "payment")}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(SERVICE_REMINDER_TYPES).map(([k, v]) => (
                            <SelectItem key={k} value={k}>{v}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-sm mb-1.5 block">تاریخ یادآوری</Label>
                      <PersianDatePicker
                        value={svcReminderDate}
                        onChange={setSvcReminderDate}
                        placeholder="انتخاب تاریخ یادآوری..."
                      />
                    </div>
                    {svcReminderDate && (
                      <div className="text-xs text-pink-700 bg-pink-100 rounded-md px-3 py-2 flex items-center gap-1.5">
                        <Bell className="h-3 w-3 flex-shrink-0" />
                        یادآوری در تاریخ {formatShamsiDate(gregorianDateToUnix(svcReminderDate))} ثبت می‌شود و یک هفته قبل از آن هشدار نشان داده می‌شود
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Separator />

              {/* نوبت بعدی */}
              <PaymentNextAppointment value={nextAppt} onChange={setNextAppt} disabled={!selectedAppt} />

              <Separator />

              {/* Loyalty Section */}
              {selectedPatientId && (loyaltyOn || walletBalance > 0) && (
                <>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 font-medium">
                        <Award className="h-4 w-4 text-amber-600" />
                        {loyaltyOn ? "باشگاه مشتریان" : "کیف پول"}
                        {!loyaltyOn ? null : patientLoyalty?.member
                          ? <LoyaltyTierBadge tier={patientLoyalty.member.tier} />
                          : <span className="text-xs font-normal text-muted-foreground">با این پرداخت عضو می‌شود</span>}
                      </div>
                      <span className="text-sm">
                        کیف پول: <span className="font-bold text-amber-700">{formatCurrency(walletBalance)}</span>
                      </span>
                    </div>
                    {walletBalance > 0 && maxWallet > 0 && (
                      <div className="rounded-lg border p-3 bg-amber-50/50 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <Label className="cursor-pointer text-sm" htmlFor="wallet-toggle">
                            پرداخت از کیف پول
                          </Label>
                          <Switch
                            id="wallet-toggle"
                            checked={walletEnabled}
                            onCheckedChange={(v) => {
                              setWalletEnabled(v);
                              setWalletInput(v ? String(maxWallet) : "");
                            }}
                          />
                        </div>
                        {walletEnabled && (
                          <div className="flex items-center gap-2">
                            <Input
                              className="w-36 h-8"
                              dir="ltr"
                              inputMode="numeric"
                              value={walletInput}
                              onChange={(e) => setWalletInput(e.target.value.replace(/[^\d]/g, ""))}
                              data-testid="input-wallet-amount"
                            />
                            <span className="text-sm text-muted-foreground">تومان</span>
                            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setWalletInput(String(maxWallet))}>
                              همه
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                    {walletApplied > 0 && (
                      <div className="text-sm bg-amber-50 rounded-md p-2 text-amber-900 flex justify-between">
                        <span>پرداخت از کیف پول:</span>
                        <span className="font-bold">{formatCurrency(walletApplied)}</span>
                      </div>
                    )}
                    {/* امتیازهای قدیمی (قبل از اعتبار سود)، فقط اگر مانده باشد */}
                    {loyaltyBalance >= (patientLoyalty?.settings.minRedeem ?? 1) && maxRedeemPoints > 0 && (
                      <div className="rounded-lg border p-3 bg-amber-50/50 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <Label className="cursor-pointer text-sm" htmlFor="redeem-toggle">
                            استفاده از {toPersianDigits(loyaltyBalance)} امتیاز قدیمی ({formatCurrency(loyaltyBalance * pointValue)})
                          </Label>
                          <Switch
                            id="redeem-toggle"
                            checked={redeemEnabled}
                            onCheckedChange={(v) => {
                              setRedeemEnabled(v);
                              setRedeemInput(v ? String(maxRedeemPoints) : "");
                            }}
                          />
                        </div>
                        {redeemEnabled && (
                          <div className="flex items-center gap-2">
                            <Input
                              className="w-28 h-8"
                              dir="ltr"
                              inputMode="numeric"
                              value={redeemInput}
                              onChange={(e) => setRedeemInput(e.target.value.replace(/[^\d]/g, ""))}
                              data-testid="input-redeem-points"
                            />
                            <span className="text-sm text-muted-foreground">امتیاز</span>
                            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setRedeemInput(String(maxRedeemPoints))}>
                              همه ({toPersianDigits(maxRedeemPoints)})
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                    {redeemPoints > 0 && (
                      <div className="text-sm bg-amber-50 rounded-md p-2 text-amber-900 flex justify-between">
                        <span>کسر بابت {toPersianDigits(redeemPoints)} امتیاز:</span>
                        <span className="font-bold">{formatCurrency(redeemToman)}</span>
                      </div>
                    )}
                  </div>
                  <Separator />
                </>
              )}

              {/* Discount Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2 font-medium cursor-pointer" htmlFor="discount-toggle">
                    <Tag className="h-4 w-4 text-pink-600" />
                    اعمال تخفیف
                  </Label>
                  <Switch
                    id="discount-toggle"
                    disabled={isFollowupPayment}
                    checked={discountEnabled}
                    onCheckedChange={(v) => {
                      setDiscountEnabled(v);
                      if (!v) { setSelectedDiscountId(null); form.setValue("discountId", undefined); }
                    }}
                  />
                </div>

                {discountEnabled && (
                  <div className="space-y-3 rounded-lg border p-3 bg-muted/30">
                    <div>
                      <Label className="text-sm mb-1 block">انتخاب تخفیف</Label>
                      <Select
                        onValueChange={(v) => setSelectedDiscountId(Number(v))}
                        value={selectedDiscountId ? String(selectedDiscountId) : undefined}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="انتخاب کد تخفیف..." />
                        </SelectTrigger>
                        <SelectContent>
                          {activeDiscounts.length === 0 && (
                            <SelectItem value="none" disabled>تخفیف فعالی وجود ندارد</SelectItem>
                          )}
                          {activeDiscounts.map(d => (
                            <SelectItem key={d.id} value={String(d.id)}>
                              {d.name} ({d.code}) — {d.type === "percentage" ? `${toPersianDigits(d.value)}٪` : formatCurrency(d.value)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {selectedDiscount && (
                      <div className="text-sm bg-pink-50 rounded-md p-2 text-pink-800 flex justify-between">
                        <span>مبلغ تخفیف:</span>
                        <span className="font-bold">
                          {selectedDiscount.type === "percentage"
                            ? formatCurrency(Math.round((originalAmount || 0) * selectedDiscount.value / 100))
                            : formatCurrency(Math.min(selectedDiscount.value, originalAmount || 0))
                          }
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Separator />

              {/* Commission Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2 font-medium cursor-pointer" htmlFor="commission-toggle">
                    <Users className="h-4 w-4 text-pink-600" />
                    تخصیص کمیسیون
                  </Label>
                  <Switch id="commission-toggle" checked={commissionEnabled} onCheckedChange={setCommissionEnabled} />
                </div>

                {autoReferrer && (
                  <div className="text-sm bg-blue-50 rounded-md p-2 text-blue-900 flex justify-between gap-2" data-testid="auto-referrer-commission">
                    <span>پورسانت خودکار معرف: {autoReferrer.name} ({toPersianDigits(autoReferrer.rate)}٪)</span>
                    <span className="font-bold">{formatCurrency(autoReferrer.amount)}</span>
                  </div>
                )}

                {commissionEnabled && (
                  <div className="space-y-3 rounded-lg border p-3 bg-muted/30">
                    <div>
                      <Label className="text-sm mb-1 block">نوع گیرنده</Label>
                      <Select
                        value={commRecipientType}
                        onValueChange={(v) => { setCommRecipientType(v as "staff" | "external" | "patient"); setCommRecipientId(null); }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="staff">کارمند (پرسنل)</SelectItem>
                          <SelectItem value="external">گیرنده خارجی</SelectItem>
                          {!loyaltyReferralAuto && <SelectItem value="patient">مراجع (معرف)</SelectItem>}
                        </SelectContent>
                      </Select>
                      {loyaltyReferralAuto && (
                        <p className="text-xs text-muted-foreground mt-1">
                          اعتبار معرفیِ معرفِ «مراجع» به‌صورت خودکار توسط باشگاه مشتریان به کیف پولش داده می‌شود؛ ثبت دستی آن مجاز نیست.
                        </p>
                      )}
                    </div>

                    <div>
                      <Label className="text-sm mb-1 block">گیرنده</Label>
                      <Select
                        value={commRecipientId ? String(commRecipientId) : undefined}
                        onValueChange={(v) => setCommRecipientId(Number(v))}
                      >
                        <SelectTrigger><SelectValue placeholder="انتخاب گیرنده..." /></SelectTrigger>
                        <SelectContent>
                          {commRecipientType === "staff"
                            ? staff?.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)
                            : commRecipientType === "patient"
                              ? patientsList?.data?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)
                              : recipients?.map(r => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)
                          }
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-sm mb-1 block">نوع محاسبه</Label>
                        <Select value={commCalcType} onValueChange={(v) => setCommCalcType(v as "percentage" | "fixed")}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="percentage">درصدی</SelectItem>
                            <SelectItem value="fixed">مبلغ ثابت</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-sm mb-1 block">
                          {commCalcType === "percentage" ? "درصد" : "مبلغ (تومان)"}
                        </Label>
                        <Input
                          type="number"
                          dir="ltr"
                          value={commCalcValue}
                          onChange={(e) => setCommCalcValue(Number(e.target.value))}
                          min={0}
                          max={commCalcType === "percentage" ? 100 : undefined}
                        />
                      </div>
                    </div>

                    {duplicateOfAuto && (
                      <div className="text-xs text-destructive">
                        این گیرنده معرفِ همین مراجع است و پورسانت خودکار می‌گیرد؛ کمیسیون دستی تکراری ثبت نمی‌شود.
                      </div>
                    )}

                    {commissionAmount > 0 && (
                      <div className="text-sm bg-amber-50 rounded-md p-2 text-amber-800 flex justify-between">
                        <span>مبلغ کمیسیون محاسبه‌شده:</span>
                        <span className="font-bold">{formatCurrency(commissionAmount)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>
            </div>

              <DialogFooter>
                <Button type="submit" disabled={createPayment.isPending}>
                  {createPayment.isPending ? "در حال ثبت..." : "ثبت پرداخت"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ─── Payments Table ──────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-4">
          {/* جست‌وجو و فیلترها */}
          <div className="mb-3 space-y-2" data-testid="payments-filters">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pr-8"
                  placeholder="جست‌وجو در مراجع، خدمت یا یادداشت..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  aria-label="جست‌وجوی پرداخت‌ها"
                />
              </div>
              <Select value={methodFilter} onValueChange={setMethodFilter}>
                <SelectTrigger className="w-[150px]" aria-label="روش پرداخت"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">همهٔ روش‌ها</SelectItem>
                  {Object.entries(methods).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" className="gap-1" onClick={exportFiltered} disabled={visiblePayments.length === 0}>
                <FileSpreadsheet className="h-4 w-4" />
                خروجی اکسل
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {DATE_PRESETS.map(({ key, label }) => (
                <Button
                  key={key}
                  size="sm"
                  variant={datePreset === key ? "default" : "outline"}
                  onClick={() => setDatePreset(key)}
                >
                  {label}
                </Button>
              ))}
              <PersianDateRangePicker
                value={datePreset === "custom" ? customRange : null}
                active={datePreset === "custom"}
                onChange={(r) => { setCustomRange(r); setDatePreset("custom"); }}
              />
              {dateRange && (
                <span className="text-xs text-muted-foreground">بازه: {formatRangeLabel(dateRange)}</span>
              )}
              {filtersActive && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setSearchText(""); setMethodFilter("all"); setDatePreset("all"); setOnlyDuplicates(false); }}
                >
                  پاک کردن فیلترها
                </Button>
              )}
            </div>
            <div className="text-sm text-muted-foreground" data-testid="payments-filter-summary">
              {toPersianDigits(visiblePayments.length)} تراکنش
              {" — "}جمع دریافتی: <span className="font-bold text-green-700">{formatCurrency(visibleTotal)}</span>
            </div>
          </div>

          {wrongMonthIds.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900" data-testid="wrong-month-notice">
              <span>
                {toPersianDigits(wrongMonthIds.size)} پرداخت در ماهی غیر از ماه انجام خدمت ثبت شده و درآمد و سودش در ماه ثبت حساب می‌شود.
                {user?.role === "admin" ? " با «انتقال به ماه خدمت» تاریخ پرداخت روز خدمت می‌شود." : " برای اصلاح به مدیر بگویید."}
              </span>
              <Button size="sm" variant={onlyWrongMonth ? "default" : "outline"} onClick={() => setOnlyWrongMonth((v) => !v)}>
                {onlyWrongMonth ? "نمایش همهٔ پرداخت‌ها" : "فقط همین موارد"}
              </Button>
            </div>
          )}
          {duplicateIds.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="duplicate-payments-notice">
              <span>
                {toPersianDigits(duplicateIds.size)} پرداخت احتمالاً تکراری است (همان مراجع، خدمت و مبلغ در کمتر از ۷ روز).
                اگر تکراری‌اند، اضافه را حذف کنید تا از دریافتی کم شود.
              </span>
              <Button size="sm" variant={onlyDuplicates ? "default" : "outline"} onClick={() => setOnlyDuplicates((v) => !v)}>
                {onlyDuplicates ? "نمایش همهٔ پرداخت‌ها" : "فقط موارد تکراری"}
              </Button>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead {...paymentSort.head("paidAt")}>تاریخ</SortableHead>
                <SortableHead {...paymentSort.head("patient")}>مراجع</SortableHead>
                <SortableHead {...paymentSort.head("service")}>خدمت</SortableHead>
                <SortableHead {...paymentSort.head("amount")}>مبلغ دریافتی</SortableHead>
                <SortableHead {...paymentSort.head("originalAmount")}>مبلغ اصلی</SortableHead>
                <SortableHead {...paymentSort.head("method")}>روش</SortableHead>
                <SortableHead {...paymentSort.head("notes")}>یادداشت</SortableHead>
                <TableHead className="text-left">عملیات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paymentSort.sorted.map((p) => (
                <TableRow
                  key={p.id}
                  onMouseEnter={() => prefetchPayment(p.id)}
                  onFocus={() => prefetchPayment(p.id)}
                >
                  <TableCell>{formatShamsiDate(p.paidAt, true)}</TableCell>
                  <TableCell className="text-sm">
                    {(p as any).patientName || "—"}
                    {duplicateIds.has(p.id) && (
                      <Badge variant="outline" className="mr-1 border-amber-400 bg-amber-50 text-amber-800 text-[10px]" title="همین مراجع، همین خدمت و همین مبلغ در کمتر از ۷ روز دوباره ثبت شده است">
                        احتمالاً تکراری
                      </Badge>
                    )}
                    {wrongMonthIds.has(p.id) && (
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-sky-800">
                        <span>خدمت: {formatShamsiDate((p as { serviceScheduledAt?: number | null }).serviceScheduledAt ?? 0)}</span>
                        {user?.role === "admin" && (
                          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={movingId === p.id}
                            onClick={() => moveToServiceDate(p as typeof p & { serviceScheduledAt?: number | null })}
                            data-testid={`move-to-service-date-${p.id}`}>
                            {movingId === p.id ? "در حال انتقال…" : "انتقال به ماه خدمت"}
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[160px] truncate">
                    {(p as any).serviceName || "—"}
                    {(p as any).sessionNumber ? ` (جلسه ${toPersianDigits((p as any).sessionNumber)})` : ""}
                  </TableCell>
                  <TableCell className="font-bold text-green-700">
                    {formatCurrency(p.amount)}
                    {!!p.walletAmount && p.walletAmount > 0 && (
                      <div className="text-xs font-normal text-amber-700">+ {formatCurrency(p.walletAmount)} از کیف پول</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {p.originalAmount !== p.amount
                      ? <span className="line-through">{formatCurrency(p.originalAmount)}</span>
                      : "—"}
                  </TableCell>
                  <TableCell><Badge variant="outline">{methods[p.method] ?? p.method}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">{p.notes || "—"}</TableCell>
                  <TableCell className="text-left">
                    <div className="flex gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                        title="مشاهده رسید"
                        onClick={() => openReceiptForPayment(p.id)}
                      >
                        <Receipt className="h-3.5 w-3.5" />
                      </Button>
                      {user?.role === "admin" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-sky-700 hover:text-sky-800 hover:bg-sky-50"
                          title="ویرایش پرداخت"
                          onClick={() => setEditTarget(p)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {user?.role === "admin" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setDeleteTarget({ id: p.id, label: `پرداخت ${formatCurrency(p.amount)}` })}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && !payments?.length && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">پرداختی ثبت نشده</TableCell>
                </TableRow>
              )}
              {!isLoading && !!payments?.length && visiblePayments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">پرداختی با این فیلترها یافت نشد</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
