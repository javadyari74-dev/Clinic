import { Router, type IRouter, type Response } from "express";
import { eq, desc, sql, and, or, isNull, lt, inArray } from "drizzle-orm";
import {
  db,
  paymentsTable,
  discountsTable,
  appointmentsTable,
  patientsTable,
  commissionsTable,
  commissionRecipientsTable,
  staffTable,
  patientAccountTransactionsTable,
  remindersTable,
} from "@workspace/db";
import {
  ListPaymentsQueryParams,
  CreatePaymentBody,
  GetPaymentParams,
  DeletePaymentParams,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity";
import { logger } from "../lib/logger";
import { firePaymentSms, fireCommissionSms, fireSurveySms, sendPaymentSms, getSmsSettings, normalizePhone } from "../lib/sms";
import {
  getLoyaltySettings,
  getLoyaltyBalance,
  applyLoyaltyOnPayment,
  LOYALTY_ERRORS,
  getMemberTier,
  tierRate,
  updateMembershipAfterPayment,
  applyProfitCashback,
  getWalletBalance,
  creditWallet,
  TIER_LABELS,
  reconcileAppointmentCashback,
  WALLET_NEGATIVE_ERROR,
  type MembershipUpdate,
} from "../lib/loyalty";
import { fireLoyaltyWelcomeSms, fireLoyaltyTierUpSms, fireLoyaltyReferralSms } from "../lib/loyalty-sms";
import {
  PAYMENT_EFFECT_MESSAGES,
  PaymentEffectError,
  accrueReferrerCommission,
  automaticReferrerOf,
  appointmentPaymentState,
  fireReferrerCommissionSms,
  isDepositPayment,
  recomputeAppointmentAfterPaymentChange,
  reversePaymentEffects,
  type ReferrerAccrual,
  type Tx,
} from "../lib/payment-effects";
import { tehranTodayIso } from "../lib/appointment-details";
import { tehranInstant } from "../lib/scheduled-sms";

const router: IRouter = Router();

// برچسب یادآوری‌های ثبت‌شده هنگام پرداخت (همان برچسب‌های صندوق)
const PAYMENT_REMINDER_TYPES: Record<string, string> = {
  followup: "پیگیری دور بعدی خدمات",
  payment: "یادآوری پرداخت",
};

const fa = (n: number) => n.toLocaleString("fa-IR");

/** نام تخفیفی که برای «تسویه کامل با مبلغ کمتر» (چانه‌زنی) ثبت می‌شود */
const NEGOTIATED_DISCOUNT = "تخفیف توافقی";
const EDIT_WALLET_NEGATIVE = "اعتباری که این پرداخت به کیف پول داده قبلاً خرج شده است؛ ویرایش این پرداخت ممکن نیست";

router.get("/payments", async (req, res): Promise<void> => {
  const query = ListPaymentsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { page, limit } = query.data;

  // تاریخ خدمت (زمان نوبت، میلی‌ثانیه) کنار هر پرداخت، تا صندوق پرداخت‌هایی را که در ماهی غیر از
  // ماه خدمت ثبت شده‌اند نشان دهد
  let q = db.select({ payment: paymentsTable, serviceScheduledAt: appointmentsTable.scheduledAt })
    .from(paymentsTable)
    .leftJoin(appointmentsTable, eq(appointmentsTable.id, paymentsTable.appointmentId))
    .orderBy(desc(paymentsTable.paidAt)).$dynamic();
  if (typeof limit === "number") {
    const offset = ((page ?? 1) - 1) * limit;
    q = q.limit(limit).offset(offset);
  }
  const rows = await q;
  res.json(rows.map((r) => ({ ...r.payment, serviceScheduledAt: r.serviceScheduledAt ?? null })));
});

type CreatePaymentInput = ReturnType<typeof CreatePaymentBody.parse>;
type PaymentRow = typeof paymentsTable.$inferSelect;
type ManualDone = { amount: number; rate: number | null; recipientType: string; referrerPatientId: number | null };

interface CreatePaymentOptions {
  /** زمان پرداخت (ثانیه یونیکس) */
  paidAt: number;
  /** در ویرایش: همان شناسهٔ پرداخت قبلی حفظ می‌شود */
  id?: number;
  /**
   * ویرایش پرداختِ موجود: تخفیفی که هنگام ثبت معتبر بوده دوباره اعتبارسنجی (فعال‌بودن، بازهٔ تاریخ،
   * حداقل مبلغ، ظرفیت) نمی‌شود؛ فقط مبلغش با مبلغ جدید دوباره حساب می‌شود.
   */
  editing?: boolean;
}

interface CreatedPayment {
  payment: PaymentRow;
  paymentPatient: typeof patientsTable.$inferSelect | null;
  loyaltyPatientId: number | null;
  membership: (MembershipUpdate & { earned: number }) | null;
  autoAccrual: ReferrerAccrual | null;
  manualDone: ManualDone | null;
  manualRecipient: { name: string; phone: string | null } | null;
}

/**
 * ثبت پرداخت و همهٔ آثارش (کیف پول، تخفیف، باشگاه، پورسانت، کمیسیون دستی، یادآوری، وضعیت نوبت)
 * داخل تراکنشِ داده‌شده. هم «ثبت پرداخت» و هم «ویرایش پرداخت» (پس از برگرداندن پرداخت قبلی)
 * از همین تابع استفاده می‌کنند تا منطق یکی بماند. خطای قابل‌نمایش → PaymentEffectError.
 */
async function createPaymentInTx(tx: Tx, input: CreatePaymentInput, opts: CreatePaymentOptions): Promise<CreatedPayment> {
  const { paidAt, editing = false } = opts;
  // ورودی‌های غیرستونی (کیف پول، امتیاز، کمیسیون دستی، یادآوری) از داده‌ی ذخیره‌شونده جدا می‌شوند
  const { applyAccountBalance, redeemPoints, manualCommission, reminder, settleInFull, ...paymentValues } = input;
  const balanceToApply = Math.abs(Math.round(applyAccountBalance ?? 0));
  const pointsToRedeem = Math.max(0, Math.round(redeemPoints ?? 0));
  // «amount» فقط مبلغ نقدی (کارت/نقد/...) است؛ سهم کیف پول و امتیاز جدا ذخیره می‌شود
  if (paymentValues.amount < 0 || paymentValues.originalAmount < 0) {
    throw new PaymentEffectError("مبلغ پرداخت نمی‌تواند منفی باشد");
  }
  if (balanceToApply > paymentValues.originalAmount) {
    throw new PaymentEffectError("مبلغ پرداخت از کیف پول بیشتر از مبلغ خدمت است");
  }

  // نوبت و مراجعِ این پرداخت (برای کیف پول، باشگاه، پورسانت معرف و پیامک)
  const hasAppointment = !!paymentValues.appointmentId && paymentValues.appointmentId > 0;
  const appt = hasAppointment
    ? await tx.select().from(appointmentsTable).where(eq(appointmentsTable.id, paymentValues.appointmentId)).get()
    : undefined;
  const paymentPatient = appt
    ? (await tx.select().from(patientsTable).where(eq(patientsTable.id, appt.patientId)).get()) ?? null
    : null;

  // اگر قرار است از موجودی اکانت استفاده شود، کفایت موجودی پیش از ثبت پرداخت بررسی می‌شود
  // (و دوباره پیش از کسر) تا «ثبت پرداخت» و «کسر موجودی» اتمیک باشند
  let balancePatientId: number | null = null;
  if (balanceToApply > 0) {
    if (!hasAppointment) throw new PaymentEffectError("برای کسر از موجودی اکانت، نوبت مرتبط لازم است");
    if (!appt) throw new PaymentEffectError("نوبت مرتبط برای کسر از موجودی اکانت یافت نشد");
    if (!paymentPatient) throw new PaymentEffectError("بیمار مرتبط برای کسر از موجودی اکانت یافت نشد");
    if (balanceToApply > paymentPatient.accountBalance) throw new PaymentEffectError("موجودی اکانت کافی نیست");
    balancePatientId = paymentPatient.id;
  }

  // ── باشگاه مشتریان: کسب/خرج امتیاز داخل تراکنشِ همان پرداخت (اتمیک) ──
  const loyaltySettings = await getLoyaltySettings();
  const loyaltyPatientId: number | null =
    appt && (loyaltySettings.enabled || pointsToRedeem > 0) ? appt.patientId : null;
  if (pointsToRedeem > 0) {
    if (!loyaltySettings.enabled) throw new PaymentEffectError("باشگاه مشتریان فعال نیست");
    if (!loyaltyPatientId) throw new PaymentEffectError("برای استفاده از امتیاز باشگاه، نوبت مرتبط لازم است");
    if (pointsToRedeem < loyaltySettings.minRedeem) {
      throw new PaymentEffectError(`حداقل امتیاز قابل استفاده ${loyaltySettings.minRedeem} امتیاز است`);
    }
    const currentBalance = await getLoyaltyBalance(tx, loyaltyPatientId);
    if (pointsToRedeem > currentBalance) throw new PaymentEffectError("امتیاز باشگاه کافی نیست");
  }

  // ── کمیسیون / اعتبار معرفی دستی (پیش‌بررسی) ──
  let manualRecipient: { name: string; phone: string | null } | null = null;
  if (manualCommission) {
    const amount = Math.round(manualCommission.amount);
    if (!(amount > 0)) throw new PaymentEffectError("مبلغ کمیسیون باید بیشتر از صفر باشد");
    const rid = manualCommission.recipientId;
    const r = manualCommission.recipientType === "staff"
      ? await tx.select({ name: staffTable.name, phone: staffTable.phone }).from(staffTable).where(eq(staffTable.id, rid)).get()
      : manualCommission.recipientType === "patient"
        ? await tx.select({ name: patientsTable.name, phone: patientsTable.phone }).from(patientsTable).where(eq(patientsTable.id, rid)).get()
        : await tx.select({ name: commissionRecipientsTable.name, phone: commissionRecipientsTable.phone }).from(commissionRecipientsTable).where(eq(commissionRecipientsTable.id, rid)).get();
    if (!r) throw new PaymentEffectError("گیرندهٔ کمیسیون یافت نشد");
    manualRecipient = { name: r.name, phone: r.phone ?? null };
    // پورسانت خودکارِ معرف همین مراجع برای همین گیرنده ثبت می‌شود؛ کمیسیون دستیِ دوم مجاز نیست
    const auto = automaticReferrerOf(paymentPatient);
    if (auto && manualCommission.recipientType !== "patient" &&
        auto.recipientType === manualCommission.recipientType && auto.recipientId === rid) {
      throw new PaymentEffectError(
        `«${r.name}» معرفِ این مراجع است و پورسانت خودکار ${fa(auto.rate)}٪ برایش ثبت می‌شود؛ کمیسیون دستی تکراری برای همین گیرنده مجاز نیست`,
      );
    }
    if (manualCommission.recipientType === "patient" && paymentPatient && rid === paymentPatient.id) {
      throw new PaymentEffectError("اعتبار معرفی نمی‌تواند به خودِ پرداخت‌کننده داده شود");
    }
  }

  // ── یادآوری پیگیری ──
  let reminderDueAt: number | null = null;
  if (reminder) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(reminder.dueDate);
    if (!m) throw new PaymentEffectError("تاریخ یادآوری نامعتبر است");
    // ظهر همان روز به وقت تهران (ثانیه)
    reminderDueAt = Math.floor(tehranInstant(Number(m[1]), Number(m[2]), Number(m[3]), 12) / 1000);
  }

  const isDeposit = isDepositPayment(paymentValues);

  // جزئیات کامل پرداخت (مراجع، خدمت، شماره جلسه، تخفیف، بیعانه و...) روی همین ردیف ذخیره می‌شود
  // تا هر تراکنش به‌صورت دائمی و کامل در صندوق ثبت بماند و در پشتیبان‌گیری بیاید.
  let membership: (MembershipUpdate & { earned: number }) | null = null;
  let manualDone: ManualDone | null = null;

  // ── تخفیف: اعتبارسنجی سمت سرور و افزایش شمارش استفاده (اتمیک) ──
  let discountFields: { discountId?: number; discountName?: string | null; discountAmount?: number | null } = {};
  if (paymentValues.discountId) {
    const d = await tx.select().from(discountsTable).where(eq(discountsTable.id, paymentValues.discountId)).get();
    if (!d) throw new PaymentEffectError("تخفیف یافت نشد");
    if (!editing) {
      if (!d.isActive) throw new PaymentEffectError("این تخفیف غیرفعال است");
      const today = tehranTodayIso();
      if (d.startDate && today < d.startDate.slice(0, 10)) throw new PaymentEffectError("زمان استفاده از این تخفیف هنوز شروع نشده است");
      if (d.endDate && today > d.endDate.slice(0, 10)) throw new PaymentEffectError("مهلت استفاده از این تخفیف تمام شده است");
      if (d.minAmount && paymentValues.originalAmount < d.minAmount) {
        throw new PaymentEffectError(`حداقل مبلغ برای این تخفیف ${fa(d.minAmount)} تومان است`);
      }
    }
    const used = await tx.update(discountsTable)
      .set({ usageCount: sql`${discountsTable.usageCount} + 1` })
      .where(editing
        ? eq(discountsTable.id, d.id)
        : and(
          eq(discountsTable.id, d.id),
          or(isNull(discountsTable.usageLimit), lt(discountsTable.usageCount, discountsTable.usageLimit)),
        ))
      .returning({ id: discountsTable.id });
    if (used.length === 0) throw new PaymentEffectError("ظرفیت استفاده از این تخفیف تمام شده است");
    const base = paymentValues.originalAmount;
    const discountAmount = d.type === "percentage" ? Math.round((base * d.value) / 100) : Math.min(d.value, base);
    discountFields = { discountId: d.id, discountName: d.name, discountAmount: discountAmount > 0 ? discountAmount : null };
  }

  // ── تخفیف توافقی (چانه‌زنی): مبلغ کمتر از مانده، به‌عنوان قیمت نهایی پذیرفته می‌شود ──
  // اختلاف به‌صورت «تخفیف توافقی» روی همین پرداخت ثبت می‌شود تا قیمت نوبت = مبلغ واقعاً
  // دریافتی شود، بدهی نماند، و سود همه‌جا از مبلغ دریافتی حساب شود.
  if (settleInFull && appt && !isDeposit) {
    const before = await appointmentPaymentState(tx, appt.id);
    const due = paymentValues.originalAmount - (discountFields.discountAmount ?? 0);
    const thisPaid = paymentValues.amount + balanceToApply + pointsToRedeem * loyaltySettings.redeemValue;
    const shortfall = due - before.paid - thisPaid;
    if (shortfall > 0) {
      discountFields = {
        ...discountFields,
        discountName: discountFields.discountName ? `${discountFields.discountName} + ${NEGOTIATED_DISCOUNT}` : NEGOTIATED_DISCOUNT,
        discountAmount: (discountFields.discountAmount ?? 0) + shortfall,
      };
    }
  }

  const [created] = await tx.insert(paymentsTable).values({
    ...paymentValues,
    ...discountFields,
    ...(opts.id ? { id: opts.id } : {}),
    paidAt,
    walletAmount: balanceToApply > 0 ? balanceToApply : null,
    pointsAmount: pointsToRedeem > 0 ? pointsToRedeem * loyaltySettings.redeemValue : null,
  }).returning();

  if (balanceToApply > 0 && balancePatientId !== null) {
    const [freshPatient] = await tx
      .select({ accountBalance: patientsTable.accountBalance })
      .from(patientsTable)
      .where(eq(patientsTable.id, balancePatientId));
    if (!freshPatient || balanceToApply > freshPatient.accountBalance) {
      // در صورت تغییر موجودی بین بررسی اولیه و این لحظه، کل تراکنش برگردانده می‌شود
      throw new PaymentEffectError("موجودی اکانت کافی نیست");
    }
    await tx.insert(patientAccountTransactionsTable).values({
      patientId: balancePatientId,
      amount: -balanceToApply,
      type: "deduct",
      description: `استفاده در پرداخت${created.serviceName ? ` — ${created.serviceName}` : ""}`,
      paymentId: created.id,
    });
    await tx
      .update(patientsTable)
      .set({ accountBalance: freshPatient.accountBalance - balanceToApply })
      .where(eq(patientsTable.id, balancePatientId));
  }

  // باشگاه مشتریان: خرج امتیاز (در صورت درخواست) و کسب امتیاز از همین پرداخت
  if (loyaltyPatientId) {
    // ضریب امتیاز بر اساس سطح فعلی عضو (قبل از این پرداخت)
    const ratePercent = loyaltySettings.enabled
      ? tierRate(await getMemberTier(tx, loyaltyPatientId), loyaltySettings)
      : 100;
    await applyLoyaltyOnPayment(tx, {
      patientId: loyaltyPatientId,
      paymentId: created.id,
      amountPaid: created.amount,
      redeemPoints: pointsToRedeem,
      settings: loyaltySettings,
      serviceName: created.serviceName,
      ratePercent,
      // پاداش باشگاه اکنون اعتبار سود خدمت در کیف پول است، نه امتیاز بر اساس مبلغ
      earnPoints: false,
    });
    // عضویت خودکار، ارتقای سطح و امتیاز معرفی — داخل همین تراکنش
    if (loyaltySettings.enabled) {
      const m = await updateMembershipAfterPayment(tx, {
        patientId: loyaltyPatientId,
        paymentId: created.id,
        settings: loyaltySettings,
        nowSec: paidAt,
        patientName: created.patientName,
      });
      // درصدی از سود خدمت (با ضریب سطح) به کیف پول مراجع
      const cashback = await applyProfitCashback(tx, {
        patientId: loyaltyPatientId,
        paymentId: created.id,
        appointmentId: created.appointmentId,
        unitsUsed: created.unitsUsed,
        settings: loyaltySettings,
        ratePercent,
        serviceName: created.serviceName,
      });
      membership = { ...m, earned: cashback.reward };
    }
  }

  // ── پورسانت خودکار معرف (کارمند/کمیسیون‌گیرنده/لیزر) روی مبلغ نقدی همین پرداخت ──
  // حالت «معرف از نوع مراجع» با اعتبار معرفی باشگاه (خودکار) یا اعتبار دستی صندوق انجام می‌شود.
  const autoAccrual = await accrueReferrerCommission(tx, { payment: created, patient: paymentPatient });

  // ── کمیسیون / اعتبار معرفی دستی ──
  if (manualCommission && manualRecipient) {
    const amount = Math.round(manualCommission.amount);
    const rate = manualCommission.rate != null && manualCommission.rate > 0 ? Math.round(manualCommission.rate) : null;
    if (manualCommission.recipientType === "patient") {
      // جلوگیری از پاداش دوباره: اگر مراجعِ این پرداخت قبلاً اعتبار معرفی خودکار باشگاه
      // را برای همین معرف ایجاد کرده (از جمله با همین پرداخت)، اعتبار دستی رد می‌شود
      if (paymentPatient) {
        const already = await tx.all<{ id: number }>(sql`
          SELECT t.id AS id FROM patient_account_transactions t
          INNER JOIN payments p ON p.id = t.payment_id
          INNER JOIN appointments a ON a.id = p.appointment_id
          WHERE t.type = 'loyalty_referral' AND t.patient_id = ${manualCommission.recipientId}
            AND a.patient_id = ${paymentPatient.id}
          LIMIT 1
        `);
        if (already.length > 0) {
          throw new PaymentEffectError(
            `اعتبار معرفی باشگاه مشتریان برای این مراجع قبلاً به «${manualRecipient.name}» داده شده است؛ اعتبار معرفی دستی تکراری مجاز نیست`,
          );
        }
      }
      const description = [
        created.patientName ? `اعتبار معرفی از پرداخت «${created.patientName}»` : "اعتبار معرفی",
        rate ? `${fa(rate)}٪` : null,
      ].filter(Boolean).join(" — ");
      await creditWallet(tx, manualCommission.recipientId, amount, "referral_credit", manualCommission.description || description, created.id);
      manualDone = { amount, rate, recipientType: "patient", referrerPatientId: manualCommission.recipientId };
    } else {
      try {
        await tx.insert(commissionsTable).values({
          recipientType: manualCommission.recipientType,
          recipientId: manualCommission.recipientId,
          appointmentId: created.appointmentId > 0 ? created.appointmentId : null,
          paymentId: created.id,
          amount,
          rate,
          description: manualCommission.description || `کمیسیون پرداخت ${fa(created.amount)} تومان`,
          status: "pending",
        });
      } catch (err) {
        if (err instanceof Error && /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(err.message)) {
          throw new PaymentEffectError("برای این پرداخت قبلاً کمیسیونی برای همین گیرنده ثبت شده است");
        }
        throw err;
      }
      manualDone = { amount, rate, recipientType: manualCommission.recipientType, referrerPatientId: null };
    }
  }

  // ── یادآوری پیگیری (با حذف پرداخت حذف می‌شود) ──
  if (reminder && reminderDueAt) {
    const label = PAYMENT_REMINDER_TYPES[reminder.type] ?? "یادآوری";
    const who = [created.patientName, created.serviceName ? `(${created.serviceName})` : null].filter(Boolean).join(" ");
    await tx.insert(remindersTable).values({
      title: who ? `${label} — ${who}` : label,
      type: reminder.type,
      status: "pending",
      dueAt: reminderDueAt,
      patientId: appt?.patientId ?? null,
      paymentId: created.id,
      description: reminder.note?.trim() || "ثبت‌شده هنگام پرداخت",
    });
  }

  // ── وضعیت نوبت: قیمت خالص روی نوبت ذخیره می‌شود و فقط با پرداخت کامل «تکمیل» می‌شود ──
  if (appt && !isDeposit) {
    const price = Math.max(0, created.originalAmount - (created.discountAmount ?? 0));
    const changes: Partial<typeof appointmentsTable.$inferInsert> = { price };
    if (typeof created.unitsUsed === "number" && created.unitsUsed > 0) changes.unitsUsed = Math.round(created.unitsUsed);
    // خدمت انجام و در صندوق ثبت شده ← نوبت «تکمیل» می‌شود (از نوبت‌های فعال خارج می‌شود)؛
    // اگر کمتر از قیمت پرداخت شده، مانده به‌عنوان بدهی در صندوق و پروندهٔ مراجع می‌ماند
    if (appt.status !== "cancelled") changes.status = "completed";
    await tx.update(appointmentsTable).set(changes).where(eq(appointmentsTable.id, appt.id));
  }

  return {
    payment: created,
    paymentPatient,
    loyaltyPatientId,
    membership,
    autoAccrual,
    manualDone,
    manualRecipient,
  };
}

/** خطاهای قابل‌نمایشِ ثبت/ویرایش پرداخت → پاسخ HTTP؛ اگر خطا شناخته‌شده نباشد false */
function sendPaymentError(err: unknown, res: Response): boolean {
  if (err instanceof PaymentEffectError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  if (err instanceof Error && err.message === LOYALTY_ERRORS.disabled) {
    res.status(400).json({ error: "باشگاه مشتریان فعال نیست" });
    return true;
  }
  if (err instanceof Error && err.message === LOYALTY_ERRORS.minRedeem) {
    res.status(400).json({ error: "امتیاز کمتر از حداقلِ قابل استفاده است" });
    return true;
  }
  if (err instanceof Error && err.message === LOYALTY_ERRORS.insufficient) {
    res.status(400).json({ error: "امتیاز باشگاه کافی نیست" });
    return true;
  }
  return false;
}

router.post("/payments", async (req, res): Promise<void> => {
  const parsed = CreatePaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // تاریخ پرداخت: پیش‌فرض «الان»؛ برای خدمتی که قبلاً انجام شده و حالا در صندوق ثبت می‌شود،
  // صندوق تاریخ واقعی (معمولاً روز خدمت) را می‌فرستد تا درآمد و سود در ماه خودش حساب شود.
  const nowSec = Math.floor(Date.now() / 1000);
  const rawPaidAt = (req.body as { paidAt?: unknown })?.paidAt;
  let paidAt = nowSec;
  if (rawPaidAt !== undefined && rawPaidAt !== null) {
    const n = Number(rawPaidAt);
    if (!Number.isInteger(n) || n < 1_577_836_800 /* ۲۰۲۰ */ || n > nowSec + 300) {
      res.status(400).json({ error: "تاریخ پرداخت نامعتبر است (نباید در آینده باشد)" });
      return;
    }
    paidAt = n;
  }

  // ثبت پرداخت و همهٔ آثارش در یک تراکنش انجام می‌شود تا اتمیک بماند.
  let result: CreatedPayment;
  try {
    result = await db.transaction((tx) => createPaymentInTx(tx, parsed.data, { paidAt }));
  } catch (err) {
    if (sendPaymentError(err, res)) return;
    throw err;
  }
  const { payment, paymentPatient, loyaltyPatientId, manualRecipient } = result;

  // پیامک اطلاع پورسانت خودکار معرف — آتش و فراموش
  fireReferrerCommissionSms(result.autoAccrual);

  // پیامک اطلاع کمیسیون/اعتبار معرفی دستی — آتش و فراموش
  const manual = result.manualDone;
  if (manual && manualRecipient) {
    try {
      fireCommissionSms({
        referrerName: manualRecipient.name,
        phone: manualRecipient.phone,
        commissionAmount: manual.amount,
        baseAmount: payment.amount,
        rate: manual.rate,
        referrerPatientId: manual.referrerPatientId,
      });
    } catch (err) {
      logger.warn({ err }, "manual commission SMS failed");
    }
  }

  // باشگاه مشتریان: امتیاز این پرداخت و موجودی (برای پیامک پرداخت) + پیامک‌های عضویت/ارتقا/معرفی
  const loyaltyResult = result.membership;
  let loyaltySms: { earned: number; balance: number; tierLabel: string } | null = null;
  if (loyaltyResult && loyaltyPatientId) {
    loyaltySms = {
      // اعتبار سودِ همین پرداخت و موجودی کیف پول (تومان)
      earned: loyaltyResult.earned,
      balance: await getWalletBalance(db, loyaltyPatientId),
      tierLabel: TIER_LABELS[loyaltyResult.tier],
    };
    if (loyaltyResult.joined) fireLoyaltyWelcomeSms(loyaltyPatientId);
    if (loyaltyResult.tierUp) fireLoyaltyTierUpSms(loyaltyPatientId, loyaltyResult.tier);
    if (loyaltyResult.referral) fireLoyaltyReferralSms(loyaltyResult.referral.referrerId, loyaltyResult.referral.points);
  }

  // پیامک اطلاع پرداخت برای بیمار — آتش و فراموش؛ خطای پیامک ثبت پرداخت را مختل نمی‌کند
  firePaymentSms({
    patientId: paymentPatient?.id ?? null,
    patientName: payment.patientName ?? paymentPatient?.name ?? null,
    phone: paymentPatient?.phone ?? null,
    amount: payment.amount,
    serviceName: payment.serviceName ?? null,
    loyalty: loyaltySms,
  });

  // پیامک نظرسنجی پس از مراجعه — فقط وقتی بیمارِ پرداخت مشخص است؛ محدودیت تکرار
  // و روشن‌بودن قابلیت داخل خود تابع بررسی می‌شود (آتش و فراموش)
  if (paymentPatient) {
    fireSurveySms({
      patientId: paymentPatient.id,
      patientName: paymentPatient.name,
      phone: paymentPatient.phone,
      paymentId: payment.id,
      appointmentId: payment.appointmentId ?? null,
      serviceName: payment.serviceName ?? null,
    });
  }

  await logActivity("create", "payment", payment.id, `پرداخت ${payment.amount.toLocaleString()} تومان ثبت شد`);
  res.status(201).json(payment);
});

// ── ویرایش پرداخت (فقط مدیر) ──────────────────────────────────────────────────
// به‌جای «حذف و ثبت دوباره»: داخل یک تراکنش، پرداخت قبلی تصاحب و همهٔ آثارش دقیقاً مثل حذف
// برگردانده می‌شود، سپس با مقادیر جدید از همان مسیر «ثبت پرداخت» دوباره ساخته می‌شود (همان شناسه).
// zod مستقیماً وابستگی این پکیج نیست؛ طرح از طرح تولیدشدهٔ api-zod ساخته می‌شود.
const UpdatePaymentBody = CreatePaymentBody.pick({
  amount: true,
  originalAmount: true,
  method: true,
  settleInFull: true,
}).partial().extend({
  paidAt: CreatePaymentBody.shape.amount.int().positive().optional(),
  notes: CreatePaymentBody.shape.notes.unwrap().nullable().optional(),
  unitsUsed: CreatePaymentBody.shape.amount.int().positive().nullable().optional(),
});

const ADMIN_ONLY_EDIT = "فقط مدیر می‌تواند پرداخت را ویرایش کند";

router.put("/payments/:id", async (req, res): Promise<void> => {
  if (req.jwtUser?.role !== "admin") {
    res.status(403).json({ error: ADMIN_ONLY_EDIT });
    return;
  }
  const params = GetPaymentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePaymentBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "اطلاعات ویرایش پرداخت نامعتبر است" });
    return;
  }
  const body = parsed.data;
  const PAYMENT_NOT_FOUND = "PAYMENT_NOT_FOUND";

  let result: { old: PaymentRow; created: CreatedPayment };
  try {
    result = await db.transaction(async (tx) => {
      // ۱) تصاحب اتمیک ردیف قبلی (مثل حذف) تا دو ویرایش/حذف هم‌زمان آثار را دوبار برنگردانند
      const [old] = await tx.delete(paymentsTable).where(eq(paymentsTable.id, params.data.id)).returning();
      if (!old) throw new Error(PAYMENT_NOT_FOUND);

      // ۲) آنچه باید پس از ساخت دوباره حفظ شود: کمیسیون/اعتبار معرفی دستی و یادآوری‌ها
      const appt = old.appointmentId > 0
        ? await tx.select().from(appointmentsTable).where(eq(appointmentsTable.id, old.appointmentId)).get()
        : undefined;
      const patient = appt
        ? (await tx.select().from(patientsTable).where(eq(patientsTable.id, appt.patientId)).get()) ?? null
        : null;
      const auto = automaticReferrerOf(patient);
      const linkedCommissions = await tx.select().from(commissionsTable).where(eq(commissionsTable.paymentId, old.id));
      const manualCommissionRow = linkedCommissions.find((c) =>
        !(auto && c.recipientType === auto.recipientType && c.recipientId === auto.recipientId) &&
        !(c.description ?? "").startsWith("پورسانت معرفی بیمار"));
      const referralCredit = (await tx.select().from(patientAccountTransactionsTable)
        .where(and(eq(patientAccountTransactionsTable.paymentId, old.id), eq(patientAccountTransactionsTable.type, "referral_credit"))))[0];
      // کیف پول‌های درگیر (مراجع و معرف‌ها) پیش از ویرایش — برای بررسی منفی‌نشدن در پایان
      const linkedWalletTxns = await tx.select().from(patientAccountTransactionsTable)
        .where(eq(patientAccountTransactionsTable.paymentId, old.id));
      const oldCashback = linkedWalletTxns.filter((t) => t.type === "loyalty_cashback").reduce((s, t) => s + t.amount, 0);
      const walletPatientIds = [...new Set([...linkedWalletTxns.map((t) => t.patientId), ...(patient ? [patient.id] : [])])];
      const balancesBefore = new Map<number, number>();
      if (walletPatientIds.length > 0) {
        const rows = await tx.select({ id: patientsTable.id, balance: patientsTable.accountBalance }).from(patientsTable)
          .where(inArray(patientsTable.id, walletPatientIds));
        for (const r of rows) balancesBefore.set(r.id, r.balance);
      }
      // یادآوری‌ها با برگرداندن پرداخت حذف می‌شوند؛ موقتاً جدا و بعد دوباره وصل می‌شوند
      const reminderIds = (await tx.update(remindersTable).set({ paymentId: null })
        .where(eq(remindersTable.paymentId, old.id)).returning({ id: remindersTable.id })).map((r) => r.id);

      // ۳) برگرداندن همهٔ آثار پرداخت قبلی (همان منطق حذف)؛ منفی‌شدن کیف پول در پایان بررسی
      // می‌شود (اعتبار سودی که برداشته می‌شود معمولاً با پرداخت جدید دوباره داده می‌شود)
      const newNotes = body.notes !== undefined ? (body.notes?.trim() || null) : old.notes;
      const oldIsDeposit = isDepositPayment(old);
      const newIsDeposit = isDepositPayment({ notes: newNotes });
      await reversePaymentEffects(tx, old, { skipWalletCheck: true, skipCashbackReconcile: true, skipAppointmentRecompute: true });

      // ۴) ساخت دوباره با مقادیر ادغام‌شده از همان مسیر «ثبت پرداخت»
      const settings = await getLoyaltySettings();
      const oldNegotiated = (old.discountName ?? "").includes(NEGOTIATED_DISCOUNT);
      const settleInFull = body.settleInFull ?? oldNegotiated;
      const amount = body.amount ?? old.amount;
      const keepRawDiscount = !old.discountId && !oldNegotiated && old.discountAmount != null;
      let manualCommission: CreatePaymentInput["manualCommission"];
      if (manualCommissionRow) {
        const rate = manualCommissionRow.rate != null && manualCommissionRow.rate > 0 ? manualCommissionRow.rate : undefined;
        manualCommission = {
          recipientType: manualCommissionRow.recipientType === "staff" ? "staff" : "external",
          recipientId: manualCommissionRow.recipientId,
          amount: rate ? Math.round((amount * rate) / 100) : manualCommissionRow.amount,
          rate,
          description: manualCommissionRow.description ?? undefined,
        };
        if (!(manualCommission.amount > 0)) manualCommission = undefined;
      } else if (referralCredit && referralCredit.amount > 0) {
        manualCommission = {
          recipientType: "patient",
          recipientId: referralCredit.patientId,
          amount: referralCredit.amount,
          description: referralCredit.description ?? undefined,
        };
      }
      const input: CreatePaymentInput = {
        appointmentId: old.appointmentId,
        discountId: old.discountId ?? undefined,
        originalAmount: body.originalAmount ?? old.originalAmount,
        amount,
        method: body.method ?? old.method,
        notes: newNotes ?? undefined,
        unitsUsed: (body.unitsUsed !== undefined ? body.unitsUsed : old.unitsUsed) ?? undefined,
        patientName: old.patientName ?? undefined,
        serviceName: old.serviceName ?? undefined,
        sessionNumber: old.sessionNumber ?? undefined,
        unitLabel: old.unitLabel ?? undefined,
        discountName: keepRawDiscount ? old.discountName ?? undefined : undefined,
        discountAmount: keepRawDiscount ? old.discountAmount ?? undefined : undefined,
        depositAmount: old.depositAmount ?? undefined,
        applyAccountBalance: old.walletAmount && old.walletAmount > 0 ? old.walletAmount : undefined,
        redeemPoints: old.pointsAmount && old.pointsAmount > 0 && settings.redeemValue > 0
          ? Math.round(old.pointsAmount / settings.redeemValue)
          : undefined,
        settleInFull: settleInFull || undefined,
        manualCommission,
      };
      const created = await createPaymentInTx(tx, input, {
        paidAt: body.paidAt ?? old.paidAt,
        id: old.id,
        editing: true,
      });

      // ۵) یادآوری‌ها دوباره به پرداخت وصل می‌شوند
      if (reminderIds.length > 0) {
        await tx.update(remindersTable).set({ paymentId: created.payment.id }).where(inArray(remindersTable.id, reminderIds));
      }
      // ۶) وضعیت نوبت: پرداخت تسویه‌ای خودش وضعیت را تنظیم کرده؛ اگر تسویه به بیعانه تبدیل شد، بازمحاسبه
      if (!oldIsDeposit && newIsDeposit) {
        await recomputeAppointmentAfterPaymentChange(tx, old.appointmentId);
      }
      // ۷) اعتبار سود تجمعیِ نوبت: اگر مبلغ کم شد، اعتبارِ اضافهٔ پرداخت‌های دیگرِ همین نوبت اصلاح می‌شود
      if (old.amount > created.payment.amount && old.appointmentId > 0) {
        const [{ cashback: newCashback }] = await tx.all<{ cashback: number }>(sql`
          SELECT COALESCE(SUM(amount), 0) AS cashback FROM patient_account_transactions
          WHERE payment_id = ${created.payment.id} AND type = 'loyalty_cashback'
        `);
        try {
          await reconcileAppointmentCashback(tx, old.appointmentId, {
            amount: old.amount - created.payment.amount,
            cashback: oldCashback - Number(newCashback),
          });
        } catch (err) {
          if (err instanceof Error && err.message === WALLET_NEGATIVE_ERROR) throw new PaymentEffectError(EDIT_WALLET_NEGATIVE);
          throw err;
        }
      }
      // ۸) هیچ کیف پولی نباید به‌خاطر این ویرایش منفی شود (اعتباری که داده و خرج شده و حالا کمتر شده)
      if (walletPatientIds.length > 0) {
        const after = await tx.select({ id: patientsTable.id, balance: patientsTable.accountBalance }).from(patientsTable)
          .where(inArray(patientsTable.id, walletPatientIds));
        for (const r of after) {
          if (r.balance < 0 && r.balance < (balancesBefore.get(r.id) ?? 0)) throw new PaymentEffectError(EDIT_WALLET_NEGATIVE);
        }
      }
      return { old, created };
    });
  } catch (err) {
    if (err instanceof Error && err.message === PAYMENT_NOT_FOUND) {
      res.status(404).json({ error: "پرداخت یافت نشد" });
      return;
    }
    if (err instanceof PaymentEffectError && err.message === PAYMENT_EFFECT_MESSAGES.walletNegative) {
      res.status(400).json({ error: EDIT_WALLET_NEGATIVE });
      return;
    }
    if (sendPaymentError(err, res)) return;
    throw err;
  }

  const { old, created } = result;
  const p = created.payment;
  const changes: string[] = [];
  if (old.amount !== p.amount) changes.push(`مبلغ ${old.amount.toLocaleString()} ← ${p.amount.toLocaleString()}`);
  if (old.originalAmount !== p.originalAmount) changes.push(`مبلغ اصلی ${old.originalAmount.toLocaleString()} ← ${p.originalAmount.toLocaleString()}`);
  if (old.method !== p.method) changes.push(`روش ${old.method} ← ${p.method}`);
  if (old.paidAt !== p.paidAt) changes.push("تاریخ");
  if ((old.notes ?? "") !== (p.notes ?? "")) changes.push("یادداشت");
  if ((old.unitsUsed ?? null) !== (p.unitsUsed ?? null)) changes.push("واحد مصرفی");
  await logActivity(
    "update",
    "payment",
    p.id,
    `پرداخت${p.patientName ? ` «${p.patientName}»` : ""} ویرایش شد${changes.length ? `: ${changes.join("، ")}` : ""}`,
  );
  res.json(p);
});

// ── ارسال دوبارهٔ پیامک رسید پرداخت ─────────────────────────────────────────
router.post("/payments/:id/send-receipt", async (req, res): Promise<void> => {
  const params = GetPaymentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const payment = await db.select().from(paymentsTable).where(eq(paymentsTable.id, params.data.id)).get();
  if (!payment) {
    res.status(404).json({ error: "پرداخت یافت نشد" });
    return;
  }
  const appt = payment.appointmentId > 0
    ? await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, payment.appointmentId)).get()
    : undefined;
  const patient = appt
    ? await db.select().from(patientsTable).where(eq(patientsTable.id, appt.patientId)).get()
    : undefined;

  const settings = await getSmsSettings();
  if (!settings.username || !settings.password || (settings.sendMode !== "pattern" && !settings.from)) {
    res.status(400).json({ error: "پنل پیامکی تنظیم نشده است؛ ابتدا اطلاعات پنل را در تنظیمات پیامک وارد کنید" });
    return;
  }
  if (!settings.enabledPayment) {
    res.status(400).json({ error: "پیامک پرداخت در تنظیمات پیامک غیرفعال است" });
    return;
  }
  if (!patient) {
    res.status(400).json({ error: "این پرداخت به پرونده‌ای وصل نیست؛ شماره‌ای برای ارسال رسید وجود ندارد" });
    return;
  }
  if (!patient.phone || !normalizePhone(patient.phone)) {
    res.status(400).json({ error: "شماره موبایل معتبری برای این مراجع ثبت نشده است" });
    return;
  }
  if (!(payment.amount > 0)) {
    res.status(400).json({ error: "مبلغ دریافتی این پرداخت صفر است؛ پیامک رسید ارسال نمی‌شود" });
    return;
  }

  // باشگاه: اعتبار سودِ همین پرداخت و موجودی فعلی کیف پول (مثل پیامک هنگام ثبت)
  let loyalty: { earned: number; balance: number; tierLabel: string } | null = null;
  const loyaltySettings = await getLoyaltySettings();
  if (loyaltySettings.enabled) {
    const [row] = await db.all<{ earned: number }>(sql`
      SELECT COALESCE(SUM(amount), 0) AS earned FROM patient_account_transactions
      WHERE payment_id = ${payment.id} AND type = 'loyalty_cashback'
    `);
    loyalty = {
      earned: Math.max(0, Number(row?.earned ?? 0)),
      balance: await getWalletBalance(db, patient.id),
      tierLabel: TIER_LABELS[await getMemberTier(db, patient.id)],
    };
  }

  const sent = await sendPaymentSms({
    patientId: patient.id,
    patientName: payment.patientName ?? patient.name,
    phone: patient.phone,
    amount: payment.amount,
    serviceName: payment.serviceName ?? null,
    loyalty,
  }, settings);
  if (!sent.ok) {
    res.status(400).json({ error: sent.error ?? "ارسال پیامک ناموفق بود" });
    return;
  }
  await logActivity("update", "payment", payment.id, `پیامک رسید پرداخت دوباره برای «${patient.name}» ارسال شد`);
  res.json({ ok: true });
});

router.get("/payments/:id", async (req, res): Promise<void> => {
  const params = GetPaymentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, params.data.id));
  if (!payment) {
    res.status(404).json({ error: "پرداخت یافت نشد" });
    return;
  }
  res.json(payment);
});

router.delete("/payments/:id", async (req, res): Promise<void> => {
  const params = DeletePaymentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // حذف پرداخت باید همه‌ی آثار مالیِ همان پرداخت را به‌صورت اتمیک برگرداند تا چیزی جا نماند
  // (کیف پول، اعتبار سود، کمیسیون، تخفیف، امتیاز، یادآوری، وضعیت نوبت — reversePaymentEffects).
  // برای جلوگیری از حذفِ هم‌زمانِ دوباره (دو درخواست موازی)، ابتدا خودِ پرداخت را به‌صورت
  // اتمیک «تصاحب» می‌کنیم: DELETE ... RETURNING؛ اگر ردیفی برنگردد یعنی درخواست دیگری
  // زودتر آن را حذف کرده، پس تراکنش لغو می‌شود و آثار مالی فقط یک‌بار برگردانده می‌شوند.
  const PAYMENT_NOT_FOUND = "PAYMENT_NOT_FOUND";
  let payment: typeof paymentsTable.$inferSelect;
  try {
    payment = await db.transaction(async (tx) => {
      const [claimed] = await tx
        .delete(paymentsTable)
        .where(eq(paymentsTable.id, params.data.id))
        .returning();
      if (!claimed) {
        throw new Error(PAYMENT_NOT_FOUND);
      }
      await reversePaymentEffects(tx, claimed);
      return claimed;
    });
  } catch (err) {
    if (err instanceof Error && err.message === PAYMENT_NOT_FOUND) {
      res.status(404).json({ error: "پرداخت یافت نشد" });
      return;
    }
    if (err instanceof PaymentEffectError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }

  await logActivity("delete", "payment", payment.id, `پرداخت ${payment.amount.toLocaleString()} تومان حذف شد`);
  res.sendStatus(204);
});

export default router;
