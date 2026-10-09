import { useState, useEffect, useMemo, useCallback } from "react";
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
} from "@workspace/api-client-react";
import { onApiError } from "@/lib/api-error";
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
import { Separator } from "@/components/ui/separator";
import { formatCurrency, formatShamsiDate, toPersianDigits, gregorianDateToUnix } from "@/lib/format";
import { Plus, Banknote, CreditCard, Trash2, Tag, Users, Receipt, Bell, Award } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PersianDatePicker } from "@/components/persian-date-picker";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { ErrorNotice } from "@/components/error-notice";
import { useToast } from "@/hooks/use-toast";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Badge } from "@/components/ui/badge";

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
function ReceiptDialog({ receipt, open, onClose }: { receipt: ReceiptData | null; open: boolean; onClose: () => void }) {
  if (!receipt) return null;

  const discountRow = receipt.discountAmount && receipt.discountAmount > 0;
  const depositRow  = receipt.depositAmount  && receipt.depositAmount  > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center text-lg">رسید پرداخت</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 font-vazirmatn" dir="rtl">
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

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="w-full">بستن</Button>
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
      },
      onError: (error) => {
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
        queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
        // حذف پرداخت وضعیت نوبت، کمیسیون‌ها، کیف پول و یادآوری را هم برمی‌گرداند
        queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListCommissionsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListRemindersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
        toast({ title: "پرداخت حذف شد" });
      },
      // پیام خطای سرور (مثلاً «پورسانت این پرداخت تسویه شده است…») نمایش داده می‌شود
      onError: onApiError("حذف پرداخت ناموفق بود"),
    },
  });

  function resetDialog() {
    form.reset({ amount: 0, originalAmount: 0, method: "cash", unitsUsed: 1 });
    setFullAmountChecked(false);
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
  }

  function onSubmit(values: z.infer<typeof formSchema>) {
    const appt = selectedAppt;
    const minRedeem = patientLoyalty?.settings.minRedeem ?? 1;
    if (redeemPoints > 0 && redeemPoints < minRedeem) {
      toast({ title: `حداقل امتیاز قابل استفاده ${toPersianDigits(minRedeem)} است`, variant: "destructive" });
      return;
    }
    // مبلغ دریافتی صفر فقط وقتی مجاز است که کل مبلغ با بیعانه/کیف پول/امتیاز پوشش داده شده باشد
    if (!(values.amount > 0) && dueBeforePoints - redeemToman - walletApplied > 0) {
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
    // مبلغ تخفیف اعمال‌شده تا روی ردیف پرداخت ذخیره و در رسید نمایش داده شود
    const discountAmt = discountEnabled && selectedDiscount
      ? selectedDiscount.type === "percentage"
        ? Math.round((values.originalAmount || 0) * selectedDiscount.value / 100)
        : Math.min(selectedDiscount.value, values.originalAmount || 0)
      : 0;
    createPayment.mutate({
      data: {
        ...values,
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

  const activeDiscounts = discounts?.filter(d => d.isActive) ?? [];

  // نوبت‌های لغونشده‌ای که هنوز پرداخت تسویه ندارند یا مانده دارند (پرداخت قسطی)
  // پرداخت بیعانه نوبت را «پرداخت‌شده کامل» نمی‌کند
  const unpaidAppointments = allActiveAppointments.filter(
    a => !a.hasCheckoutPayment || (a.remaining ?? 0) > 0
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">صندوق</h1>
          <p className="text-muted-foreground mt-1">مدیریت پرداخت‌ها و دریافت‌ها</p>
        </div>
        <Button className="gap-2" onClick={() => { resetDialog(); setIsOpen(true); }}>
          <Plus className="h-4 w-4" />
          ثبت پرداخت
        </Button>
      </div>

      {isError && <ErrorNotice onRetry={() => refetch()} />}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Banknote className="h-4 w-4" /> دریافتی امروز
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalToday)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CreditCard className="h-4 w-4" /> کل تراکنش‌ها
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{toPersianDigits(payments?.length ?? 0)} تراکنش</div>
          </CardContent>
        </Card>
      </div>

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        title={`حذف ${deleteTarget?.label ?? ''}`}
        description={`آیا از حذف «${deleteTarget?.label ?? ''}» مطمئن هستید؟ این عمل قابل بازگشت نیست.`}
        onConfirm={() => { deletePayment.mutate({ id: deleteTarget!.id }); setDeleteTarget(null); }}
        onCancel={() => setDeleteTarget(null)}
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>تاریخ</TableHead>
                <TableHead>مراجع</TableHead>
                <TableHead>خدمت</TableHead>
                <TableHead>مبلغ دریافتی</TableHead>
                <TableHead>مبلغ اصلی</TableHead>
                <TableHead>روش</TableHead>
                <TableHead>یادداشت</TableHead>
                <TableHead className="text-left">عملیات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments?.map((p) => (
                <TableRow
                  key={p.id}
                  onMouseEnter={() => prefetchPayment(p.id)}
                  onFocus={() => prefetchPayment(p.id)}
                >
                  <TableCell>{formatShamsiDate(p.paidAt, true)}</TableCell>
                  <TableCell className="text-sm">{(p as any).patientName || "—"}</TableCell>
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
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
