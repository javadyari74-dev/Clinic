import { useState, useEffect, useMemo, useCallback } from "react";
import {
  useListPayments, useCreatePayment, useDeletePayment, getListPaymentsQueryKey,
  useListAppointments, getListAppointmentsQueryKey, useUpdateAppointment,
  useListDiscounts, useListStaff, useListCommissionRecipients,
  useCreateCommission, getListCommissionsQueryKey,
  useCreateReminder, getListRemindersQueryKey,
  useListPatients, getListPatientsQueryKey,
  useCreatePatientAccountTransaction, getListPatientAccountTransactionsQueryKey, getGetPatientQueryKey,
} from "@workspace/api-client-react";
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
import { formatCurrency, formatShamsiDate, toPersianDigits } from "@/lib/format";
import { Plus, Banknote, CreditCard, Trash2, Tag, Users, Receipt, Bell, Wallet } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { PersianDatePicker } from "@/components/persian-date-picker";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { useToast } from "@/hooks/use-toast";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Badge } from "@/components/ui/badge";
import { TierBadge } from "@/components/tier-badge";

const methods: Record<string, string> = {
  cash: "نقد",
  card: "کارت",
  transfer: "کارت به کارت",
  insurance: "بیمه",
};

const REFERRER_TYPE_LABELS: Record<string, string> = {
  patient: "مراجع",
  recipient: "کمیسیون‌گیرنده",
  staff: "کارمند",
  laser: "لیزر",
};

// ─── Shamsi → Unix helper ──────────────────────────────────────────────────────
function shamsiStringToUnix(shamsiStr: string): number {
  if (!shamsiStr) return 0;
  const [y, m, day] = shamsiStr.split("-").map(Number);
  const ref = new Date();
  ref.setHours(12, 0, 0, 0);
  const rp = new Intl.DateTimeFormat("en-US-u-ca-persian", {
    year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(ref);
  const rg = (t: string) => parseInt(rp.find(p => p.type === t)?.value ?? "0");
  const approx = Math.round(
    (y - rg("year")) * 365.25 + ((m - 1) * 30.5 + day) - ((rg("month") - 1) * 30.5 + rg("day")),
  );
  const base = new Date(ref);
  base.setDate(base.getDate() + approx);
  for (let offset = -8; offset <= 8; offset++) {
    const test = new Date(base);
    test.setDate(test.getDate() + offset);
    const tp = new Intl.DateTimeFormat("en-US-u-ca-persian", {
      year: "numeric", month: "numeric", day: "numeric",
    }).formatToParts(test);
    const tg = (t: string) => parseInt(tp.find(p => p.type === t)?.value ?? "0");
    if (tg("year") === y && tg("month") === m && tg("day") === day) {
      return Math.floor(test.getTime() / 1000);
    }
  }
  return Math.floor(base.getTime() / 1000);
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
                <span>بیعانه پرداخت‌شده:</span>
                <span>− {formatCurrency(receipt.depositAmount)}</span>
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
  const { data: payments, isLoading } = useListPayments();
  const { data: scheduledAppts } = useListAppointments({ status: "scheduled", limit: 1000 });
  const { data: confirmedAppts } = useListAppointments({ status: "confirmed", limit: 1000 });
  const allActiveAppointments = useMemo(() => [
    ...(scheduledAppts?.data ?? []),
    ...(confirmedAppts?.data ?? []),
  ], [scheduledAppts, confirmedAppts]);
  const { data: discounts } = useListDiscounts();
  const { data: staff } = useListStaff();
  const { data: recipients } = useListCommissionRecipients();
  const { data: patientsList } = useListPatients();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [isOpen, setIsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);
  const [fullAmountChecked, setFullAmountChecked] = useState(false);
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

  // Receipt dialog state
  const [activeReceipt, setActiveReceipt] = useState<ReceiptData | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  // Service reminder state
  const [svcReminderEnabled, setSvcReminderEnabled] = useState(false);
  const [svcReminderType, setSvcReminderType] = useState<"followup" | "payment">("followup");
  const [svcReminderDate, setSvcReminderDate] = useState("");

  // Account balance application state
  const [balanceApplyEnabled, setBalanceApplyEnabled] = useState(false);
  const [balanceApplied, setBalanceApplied] = useState(0);

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
  const selectedPatientId = (selectedAppt as any)?.patientId as number | undefined;
  const selectedPatient = useMemo(
    () => (patientsList?.data ?? []).find(p => p.id === selectedPatientId) ?? null,
    [patientsList, selectedPatientId],
  );
  const patientBalance = selectedPatient?.accountBalance ?? 0;

  // اگر بیمارِ انتخاب‌شده معرفی از نوع «مراجع» داشته باشد، بخش تخصیص کمیسیون به‌صورت
  // خودکار فعال و با گیرنده‌ی معرف + درصدِ ذخیره‌شده پر می‌شود تا اعتبار به حساب او شارژ شود.
  useEffect(() => {
    if (selectedPatient && selectedPatient.referrerType === "patient" && selectedPatient.referrerId) {
      setCommissionEnabled(true);
      setCommRecipientType("patient");
      setCommRecipientId(selectedPatient.referrerId);
      setCommCalcType("percentage");
      setCommCalcValue(selectedPatient.referrerRate ?? 0);
    } else {
      // بیمارِ انتخاب‌شده معرفِ مراجع ندارد؛ اگر بخش کمیسیون قبلاً به‌صورت خودکار روی
      // حالت «مراجع» پر شده بود، آن را پاک می‌کنیم تا اعتبار اشتباهی به معرفِ قبلی داده نشود.
      setCommRecipientType((prev) => {
        if (prev === "patient") {
          setCommissionEnabled(false);
          setCommRecipientId(null);
          setCommCalcValue(0);
          return "staff";
        }
        return prev;
      });
    }
  }, [selectedPatient]);

  // وقتی نوبت انتخاب می‌شه: واحد مصرفی پیش‌فرض و مبلغ اصلی را تنظیم کن و بیعانه را ذخیره کن
  useEffect(() => {
    if (!selectedAppt) {
      setCurrentDeposit(0);
      return;
    }
    const deposit = (selectedAppt as any).deposit ?? 0;
    setCurrentDeposit(deposit);
    if (selectedAppt.priceMode === "per_unit") {
      const u = selectedAppt.unitsUsed ?? selectedAppt.serviceUnitCount ?? 1;
      form.setValue("unitsUsed", u);
      form.setValue("originalAmount", (selectedAppt.unitPrice ?? 0) * u);
    } else {
      form.setValue("unitsUsed", 1);
      form.setValue("originalAmount", selectedAppt.servicePrice ?? 0);
    }
    if (deposit > 0) {
      form.setValue("notes", `مراجع مبلغ ${deposit.toLocaleString()} تومان بیعانه برای این نوبت پرداخت کرده و از مبلغ نهایی کسر می‌شود`);
    } else {
      form.setValue("notes", "");
    }
  }, [selectedAppt]);

  // با تغییر واحد مصرفی، مبلغ اصلی خدمات per_unit بازمحاسبه می‌شود
  useEffect(() => {
    if (!selectedAppt || selectedAppt.priceMode !== "per_unit") return;
    const u = unitsUsed && unitsUsed > 0 ? unitsUsed : 1;
    form.setValue("originalAmount", (selectedAppt.unitPrice ?? 0) * u);
  }, [unitsUsed, selectedAppt]);

  // وقتی چک‌باکس «مبلغ کامل» تغییر می‌کنه
  useEffect(() => {
    if (fullAmountChecked) {
      const afterDeposit = Math.max(0, (originalAmount || 0) - currentDeposit);
      const applied = balanceApplyEnabled ? Math.min(patientBalance, afterDeposit) : 0;
      setBalanceApplied(applied);
      form.setValue("amount", Math.max(0, afterDeposit - applied));
    }
  }, [fullAmountChecked, originalAmount, currentDeposit, balanceApplyEnabled, patientBalance]);

  const selectedDiscount = useMemo(
    () => discounts?.find(d => d.id === selectedDiscountId) ?? null,
    [discounts, selectedDiscountId]
  );

  // محاسبه مبلغ پس از تخفیف و کسر بیعانه و استفاده از موجودی اکانت
  useEffect(() => {
    const base = originalAmount || 0;
    let afterDiscount: number;
    if (discountEnabled && selectedDiscount) {
      if (selectedDiscount.type === "percentage") {
        afterDiscount = Math.round(base * (1 - selectedDiscount.value / 100));
      } else {
        afterDiscount = Math.max(0, base - selectedDiscount.value);
      }
      form.setValue("discountId", selectedDiscount.id);
    } else {
      afterDiscount = base;
      form.setValue("discountId", undefined);
    }
    const afterDeposit = Math.max(0, afterDiscount - currentDeposit);
    const applied = balanceApplyEnabled ? Math.min(patientBalance, afterDeposit) : 0;
    setBalanceApplied(applied);
    form.setValue("amount", Math.max(0, afterDeposit - applied));
  }, [discountEnabled, selectedDiscount, originalAmount, currentDeposit, balanceApplyEnabled, patientBalance]);

  const commissionAmount = useMemo(() => {
    const base = paidAmount || 0;
    if (commCalcType === "percentage") return Math.round(base * commCalcValue / 100);
    return commCalcValue;
  }, [commCalcType, commCalcValue, paidAmount]);

  const createCommission = useCreateCommission({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCommissionsQueryKey() });
      },
    },
  });

  const createReminder = useCreateReminder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRemindersQueryKey() });
      },
    },
  });

  const createAccountTxn = useCreatePatientAccountTransaction({
    mutation: {
      onSuccess: (_data, vars) => {
        queryClient.invalidateQueries({ queryKey: getListPatientsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPatientQueryKey(vars.id) });
        queryClient.invalidateQueries({ queryKey: getListPatientAccountTransactionsQueryKey(vars.id) });
      },
      onError: () => {
        // این میوتیشن هم برای کسر موجودی و هم برای اعتبار معرفی استفاده می‌شود؛
        // اگر ناموفق شد، اپراتور باید مطلع شود تا حساب مراجع را دستی اصلاح کند.
        toast({
          title: "ثبت تراکنش حساب مراجع ناموفق بود",
          description: "پرداخت ثبت شد اما تراکنش حساب مراجع (کسر موجودی یا اعتبار معرفی) اعمال نشد. لطفاً حساب را دستی بررسی کنید.",
          variant: "destructive",
        });
      },
    },
  });

  const updateAppointment = useUpdateAppointment();

  const createPayment = useCreatePayment({
    mutation: {
      onSuccess: (payment) => {
        queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });

        // وقتی پرداخت ثبت شد، نوبت مرتبط به «تکمیل شده» تبدیل می‌شود
        const apptIdForComplete = form.getValues("appointmentId");
        if (apptIdForComplete && apptIdForComplete > 0) {
          updateAppointment.mutate(
            { id: apptIdForComplete, data: { status: "completed" } },
            {
              onSuccess: () => {
                queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
                queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey({ status: "scheduled" }) });
                queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey({ status: "confirmed" }) });
              },
            }
          );
        }

        // کمیسیون
        if (commissionEnabled && commRecipientId && commissionAmount > 0) {
          const apptId = form.getValues("appointmentId");
          const appt = allActiveAppointments.find(a => a.id === apptId);

          if (commRecipientType === "patient") {
            // معرف از نوع مراجع → اعتبار معرفی به حساب همان بیمارِ معرف شارژ می‌شود
            const payerName = selectedPatient?.name;
            createAccountTxn.mutate({
              id: commRecipientId,
              data: {
                amount: commissionAmount,
                type: "referral_credit",
                description: [
                  payerName ? `اعتبار معرفی از پرداخت «${payerName}»` : "اعتبار معرفی",
                  commCalcType === "percentage" ? `${toPersianDigits(commCalcValue)}٪` : null,
                ].filter(Boolean).join(" — "),
              },
            });
          } else {
            const recipientName =
              commRecipientType === "staff"
                ? staff?.find(s => s.id === commRecipientId)?.name
                : recipients?.find(r => r.id === commRecipientId)?.name;
            const desc = [
              appt?.serviceName,
              commCalcType === "percentage" ? `${toPersianDigits(commCalcValue)}٪` : null,
              `${formatCurrency(commissionAmount)}`,
              recipientName ? `${recipientName} (${commRecipientType === "staff" ? "پرسنل" : "خارجی"})` : null,
            ].filter(Boolean).join(" — ");

            createCommission.mutate({
              data: {
                recipientType: commRecipientType,
                recipientId: commRecipientId,
                appointmentId: form.getValues("appointmentId") ?? undefined,
                amount: commissionAmount,
                rate: commCalcType === "percentage" ? commCalcValue : undefined,
                description: desc || `کمیسیون پرداخت ${payment.amount.toLocaleString()} تومان`,
                status: "pending",
              },
            });
          }
        }

        // استفاده از موجودی اکانت: کسر مبلغ مصرف‌شده از حساب مراجع
        if (balanceApplyEnabled && balanceApplied > 0 && selectedPatientId) {
          const appt3 = allActiveAppointments.find(a => a.id === form.getValues("appointmentId"));
          createAccountTxn.mutate({
            id: selectedPatientId,
            data: {
              amount: -balanceApplied,
              type: "deduct",
              description: `استفاده در پرداخت${appt3?.serviceName ? ` — ${appt3.serviceName}` : ""}`,
            },
          });
        }

        // رسید از ردیف پرداختِ ذخیره‌شده در دیتابیس ساخته می‌شود (جزئیات کامل و دائمی)
        const receipt = receiptFromPayment(payment);

        // ثبت یادآوری خدمات (اگر فعال باشد)
        if (svcReminderEnabled && svcReminderDate) {
          const dueAt = shamsiStringToUnix(svcReminderDate);
          if (dueAt > 0) {
            const apptId = form.getValues("appointmentId");
            const appt2 = allActiveAppointments.find(a => a.id === apptId);
            const patientId = (appt2 as any)?.patientId ?? undefined;
            const reminderTitle = appt2
              ? `${SERVICE_REMINDER_TYPES[svcReminderType]} — ${appt2.patientName} (${appt2.serviceName})`
              : SERVICE_REMINDER_TYPES[svcReminderType];
            createReminder.mutate({
              data: {
                title: reminderTitle,
                type: svcReminderType,
                status: "pending",
                dueAt,
                patientId,
                description: `ثبت‌شده هنگام پرداخت در تاریخ ${formatShamsiDate(payment.paidAt)}`,
              },
            });
          }
        }

        setIsOpen(false);
        resetDialog();
        // نمایش رسید پس از ثبت موفق
        setActiveReceipt(receipt);
        setReceiptOpen(true);
        toast({ title: "پرداخت با موفقیت ثبت شد" });
      },
    },
  });

  const deletePayment = useDeletePayment({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
        toast({ title: "پرداخت حذف شد" });
      },
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
    setBalanceApplyEnabled(false);
    setBalanceApplied(0);
  }

  function onSubmit(values: z.infer<typeof formSchema>) {
    const appt = selectedAppt;
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
        // وقتی موجودی اکانت یا بیعانه بخشی/تمام مبلغ را پوشش دهد، مبلغِ نقدیِ صفر معتبر است و نباید به مبلغ کل برگردد
        amount: (balanceApplyEnabled || currentDeposit > 0) ? values.amount : (values.amount || values.originalAmount),
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
      },
    });
  }

  function openReceiptForPayment(paymentId: number) {
    const p = payments?.find(x => x.id === paymentId);
    if (!p) {
      toast({ title: "تراکنش یافت نشد", variant: "destructive" });
      return;
    }
    setActiveReceipt(receiptFromPayment(p));
    setReceiptOpen(true);
  }

  const totalToday = payments?.reduce((sum, p) => {
    const today = Math.floor(Date.now() / 1000 / 86400) * 86400;
    return p.paidAt >= today ? sum + p.amount : sum;
  }, 0) ?? 0;

  const activeDiscounts = discounts?.filter(d => d.isActive) ?? [];

  // نوبت‌های فعال که هنوز پرداخت کامل ندارند
  // پرداخت بیعانه نباید نوبت را «پرداخت‌شده کامل» در نظر بگیرد
  const paidAppointmentIds = new Set(
    payments
      ?.filter(p => (p as any).notes !== "بیعانه")
      .map(p => p.appointmentId)
      .filter(id => id && id > 0) ?? []
  );
  const unpaidAppointments = allActiveAppointments.filter(
    a => !paidAppointmentIds.has(a.id)
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
                        const deposit = (a as any).deposit;
                        const apptCode = (a as any).appointmentCode;
                        const dateStr = formatShamsiDate(a.scheduledAt);
                        return (
                          <SelectItem key={a.id} value={String(a.id)}>
                            <span className="block truncate">
                              {apptCode ? `${apptCode} — ` : ""}{a.patientName} — {a.serviceName} — {dateStr}
                              {deposit && deposit > 0 ? ` (بیعانه: ${deposit.toLocaleString()} تومان)` : ""}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Units used (per-unit priced services only) */}
              {isPerUnit && (
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

              {/* Patient Info Panel (tier + referrer) */}
              {selectedPatient && (
                <>
                  <div className="rounded-lg border p-3 bg-muted/30 space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">مراجع:</span>
                      <span className="font-medium">{selectedPatient.name}</span>
                      <TierBadge tier={selectedPatient.tier} showLabel />
                    </div>
                    {selectedPatient.referrerType && selectedPatient.referrerId ? (
                      <div className="flex items-center gap-2 text-sm flex-wrap">
                        <span className="text-muted-foreground">معرف:</span>
                        <span className="font-medium">{selectedPatient.referrerName ?? "—"}</span>
                        <Badge variant="outline" className="text-[11px]">
                          {REFERRER_TYPE_LABELS[selectedPatient.referrerType] ?? selectedPatient.referrerType}
                        </Badge>
                        {selectedPatient.referrerRate != null && (
                          <span className="text-xs text-muted-foreground">({toPersianDigits(selectedPatient.referrerRate)}٪ پورسانت)</span>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">بدون معرف</div>
                    )}
                  </div>
                  <Separator />
                </>
              )}

              {/* Account Balance Section */}
              {selectedPatient && patientBalance > 0 && (
                <>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="flex items-center gap-2 font-medium cursor-pointer" htmlFor="balance-toggle">
                        <Wallet className="h-4 w-4 text-emerald-600" />
                        استفاده از موجودی اکانت
                      </Label>
                      <Switch id="balance-toggle" checked={balanceApplyEnabled} onCheckedChange={setBalanceApplyEnabled} />
                    </div>
                    <div className="text-sm rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 flex justify-between text-emerald-800">
                      <span>موجودی اکانت {selectedPatient.name}:</span>
                      <span className="font-bold font-mono">{formatCurrency(patientBalance)}</span>
                    </div>
                    {balanceApplyEnabled && balanceApplied > 0 && (
                      <div className="text-sm rounded-md bg-emerald-100 px-3 py-2 flex justify-between text-emerald-900">
                        <span>مبلغ کسرشده از اکانت:</span>
                        <span className="font-bold font-mono">− {formatCurrency(balanceApplied)}</span>
                      </div>
                    )}
                  </div>
                  <Separator />
                </>
              )}

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
                        یادآوری در تاریخ {svcReminderDate.replace(/-/g, "/")} ثبت می‌شود و یک هفته قبل از آن هشدار نشان داده می‌شود
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Separator />

              {/* Discount Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2 font-medium cursor-pointer" htmlFor="discount-toggle">
                    <Tag className="h-4 w-4 text-pink-600" />
                    اعمال تخفیف
                  </Label>
                  <Switch
                    id="discount-toggle"
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

                {commissionEnabled && (
                  <div className="space-y-3 rounded-lg border p-3 bg-muted/30">
                    {commRecipientType === "patient" && (
                      <div className="text-xs rounded-md bg-pink-50 border border-pink-200 px-3 py-2 text-pink-800">
                        این بیمار توسط یک مراجعِ دیگر معرفی شده؛ مبلغِ کمیسیون به‌صورت اعتبار به حساب معرف اضافه می‌شود.
                      </div>
                    )}

                    <div>
                      <Label className="text-sm mb-1 block">نوع گیرنده</Label>
                      <Select
                        value={commRecipientType}
                        onValueChange={(v) => { setCommRecipientType(v as "staff" | "external" | "patient"); setCommRecipientId(null); }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="patient">مراجع (معرف)</SelectItem>
                          <SelectItem value="staff">کارمند (پرسنل)</SelectItem>
                          <SelectItem value="external">گیرنده خارجی</SelectItem>
                        </SelectContent>
                      </Select>
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
                              ? (patientsList?.data ?? []).map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name} ({p.fileNumber})</SelectItem>)
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
                <TableRow key={p.id}>
                  <TableCell>{formatShamsiDate(p.paidAt, true)}</TableCell>
                  <TableCell className="text-sm">{(p as any).patientName || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[160px] truncate">
                    {(p as any).serviceName || "—"}
                    {(p as any).sessionNumber ? ` (جلسه ${toPersianDigits((p as any).sessionNumber)})` : ""}
                  </TableCell>
                  <TableCell className="font-bold text-green-700">{formatCurrency(p.amount)}</TableCell>
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
