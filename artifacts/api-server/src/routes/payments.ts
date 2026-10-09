import { Router, type IRouter } from "express";
import { eq, desc, sql, and, or, isNull, lt } from "drizzle-orm";
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
import { firePaymentSms, fireCommissionSms, fireSurveySms } from "../lib/sms";
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
  type MembershipUpdate,
} from "../lib/loyalty";
import { fireLoyaltyWelcomeSms, fireLoyaltyTierUpSms, fireLoyaltyReferralSms } from "../lib/loyalty-sms";
import {
  PaymentEffectError,
  accrueReferrerCommission,
  automaticReferrerOf,
  appointmentPaymentState,
  fireReferrerCommissionSms,
  isDepositPayment,
  reversePaymentEffects,
  type ReferrerAccrual,
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

router.get("/payments", async (req, res): Promise<void> => {
  const query = ListPaymentsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { page, limit } = query.data;

  let q = db.select().from(paymentsTable).orderBy(desc(paymentsTable.paidAt)).$dynamic();
  if (typeof limit === "number") {
    const offset = ((page ?? 1) - 1) * limit;
    q = q.limit(limit).offset(offset);
  }
  const rows = await q;
  res.json(rows);
});

router.post("/payments", async (req, res): Promise<void> => {
  const parsed = CreatePaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const paidAt = Math.floor(Date.now() / 1000);
  // ورودی‌های غیرستونی (کیف پول، امتیاز، کمیسیون دستی، یادآوری) از داده‌ی ذخیره‌شونده جدا می‌شوند
  const { applyAccountBalance, redeemPoints, manualCommission, reminder, ...paymentValues } = parsed.data;
  const balanceToApply = Math.abs(Math.round(applyAccountBalance ?? 0));
  const pointsToRedeem = Math.max(0, Math.round(redeemPoints ?? 0));
  // «amount» فقط مبلغ نقدی (کارت/نقد/...) است؛ سهم کیف پول و امتیاز جدا ذخیره می‌شود
  if (paymentValues.amount < 0 || paymentValues.originalAmount < 0) {
    res.status(400).json({ error: "مبلغ پرداخت نمی‌تواند منفی باشد" });
    return;
  }
  if (balanceToApply > paymentValues.originalAmount) {
    res.status(400).json({ error: "مبلغ پرداخت از کیف پول بیشتر از مبلغ خدمت است" });
    return;
  }

  // نوبت و مراجعِ این پرداخت (برای کیف پول، باشگاه، پورسانت معرف و پیامک)
  const hasAppointment = !!paymentValues.appointmentId && paymentValues.appointmentId > 0;
  const appt = hasAppointment
    ? await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, paymentValues.appointmentId)).get()
    : undefined;
  const paymentPatient = appt
    ? (await db.select().from(patientsTable).where(eq(patientsTable.id, appt.patientId)).get()) ?? null
    : null;

  // اگر قرار است از موجودی اکانت استفاده شود، کفایت موجودی پیش از ثبت پرداخت بررسی می‌شود
  // (و دوباره داخل تراکنش) تا «ثبت پرداخت» و «کسر موجودی» اتمیک باشند
  let balancePatientId: number | null = null;
  if (balanceToApply > 0) {
    if (!hasAppointment) {
      res.status(400).json({ error: "برای کسر از موجودی اکانت، نوبت مرتبط لازم است" });
      return;
    }
    if (!appt) {
      res.status(400).json({ error: "نوبت مرتبط برای کسر از موجودی اکانت یافت نشد" });
      return;
    }
    if (!paymentPatient) {
      res.status(400).json({ error: "بیمار مرتبط برای کسر از موجودی اکانت یافت نشد" });
      return;
    }
    if (balanceToApply > paymentPatient.accountBalance) {
      res.status(400).json({ error: "موجودی اکانت کافی نیست" });
      return;
    }
    balancePatientId = paymentPatient.id;
  }

  // ── باشگاه مشتریان: کسب/خرج امتیاز داخل تراکنشِ همان پرداخت (اتمیک) ──
  const loyaltySettings = await getLoyaltySettings();
  const loyaltyPatientId: number | null =
    appt && (loyaltySettings.enabled || pointsToRedeem > 0) ? appt.patientId : null;
  if (pointsToRedeem > 0) {
    if (!loyaltySettings.enabled) {
      res.status(400).json({ error: "باشگاه مشتریان فعال نیست" });
      return;
    }
    if (!loyaltyPatientId) {
      res.status(400).json({ error: "برای استفاده از امتیاز باشگاه، نوبت مرتبط لازم است" });
      return;
    }
    if (pointsToRedeem < loyaltySettings.minRedeem) {
      res.status(400).json({ error: `حداقل امتیاز قابل استفاده ${loyaltySettings.minRedeem} امتیاز است` });
      return;
    }
    const currentBalance = await getLoyaltyBalance(db, loyaltyPatientId);
    if (pointsToRedeem > currentBalance) {
      res.status(400).json({ error: "امتیاز باشگاه کافی نیست" });
      return;
    }
  }

  // ── کمیسیون / اعتبار معرفی دستی (پیش‌بررسی؛ ثبت داخل تراکنش) ──
  let manualRecipient: { name: string; phone: string | null } | null = null;
  if (manualCommission) {
    const amount = Math.round(manualCommission.amount);
    if (!(amount > 0)) {
      res.status(400).json({ error: "مبلغ کمیسیون باید بیشتر از صفر باشد" });
      return;
    }
    const rid = manualCommission.recipientId;
    const r = manualCommission.recipientType === "staff"
      ? await db.select({ name: staffTable.name, phone: staffTable.phone }).from(staffTable).where(eq(staffTable.id, rid)).get()
      : manualCommission.recipientType === "patient"
        ? await db.select({ name: patientsTable.name, phone: patientsTable.phone }).from(patientsTable).where(eq(patientsTable.id, rid)).get()
        : await db.select({ name: commissionRecipientsTable.name, phone: commissionRecipientsTable.phone }).from(commissionRecipientsTable).where(eq(commissionRecipientsTable.id, rid)).get();
    if (!r) {
      res.status(400).json({ error: "گیرندهٔ کمیسیون یافت نشد" });
      return;
    }
    manualRecipient = { name: r.name, phone: r.phone ?? null };
    // پورسانت خودکارِ معرف همین مراجع برای همین گیرنده ثبت می‌شود؛ کمیسیون دستیِ دوم مجاز نیست
    const auto = automaticReferrerOf(paymentPatient);
    if (auto && manualCommission.recipientType !== "patient" &&
        auto.recipientType === manualCommission.recipientType && auto.recipientId === rid) {
      res.status(400).json({
        error: `«${r.name}» معرفِ این مراجع است و پورسانت خودکار ${fa(auto.rate)}٪ برایش ثبت می‌شود؛ کمیسیون دستی تکراری برای همین گیرنده مجاز نیست`,
      });
      return;
    }
    if (manualCommission.recipientType === "patient" && paymentPatient && rid === paymentPatient.id) {
      res.status(400).json({ error: "اعتبار معرفی نمی‌تواند به خودِ پرداخت‌کننده داده شود" });
      return;
    }
  }

  // ── یادآوری پیگیری ──
  let reminderDueAt: number | null = null;
  if (reminder) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(reminder.dueDate);
    if (!m) {
      res.status(400).json({ error: "تاریخ یادآوری نامعتبر است" });
      return;
    }
    // ظهر همان روز به وقت تهران (ثانیه)
    reminderDueAt = Math.floor(tehranInstant(Number(m[1]), Number(m[2]), Number(m[3]), 12) / 1000);
  }

  const isDeposit = isDepositPayment(paymentValues);

  // جزئیات کامل پرداخت (مراجع، خدمت، شماره جلسه، تخفیف، بیعانه و...) روی همین ردیف ذخیره می‌شود
  // تا هر تراکنش به‌صورت دائمی و کامل در صندوق ثبت بماند و در پشتیبان‌گیری بیاید.
  // ثبت پرداخت و همهٔ آثارش (کیف پول، تخفیف، باشگاه، پورسانت، کمیسیون دستی، یادآوری، وضعیت نوبت)
  // در یک تراکنش انجام می‌شود تا اتمیک بماند.
  let membership: (MembershipUpdate & { earned: number }) | null = null;
  let autoAccrual: ReferrerAccrual | null = null;
  type ManualDone = { amount: number; rate: number | null; recipientType: string; referrerPatientId: number | null };
  let manualDone: ManualDone | null = null;
  let payment: typeof paymentsTable.$inferSelect;
  try {
    payment = await db.transaction(async (tx) => {
      // ── تخفیف: اعتبارسنجی سمت سرور و افزایش شمارش استفاده (اتمیک) ──
      let discountFields: { discountId?: number; discountName?: string | null; discountAmount?: number | null } = {};
      if (paymentValues.discountId) {
        const d = await tx.select().from(discountsTable).where(eq(discountsTable.id, paymentValues.discountId)).get();
        if (!d) throw new PaymentEffectError("تخفیف یافت نشد");
        if (!d.isActive) throw new PaymentEffectError("این تخفیف غیرفعال است");
        const today = tehranTodayIso();
        if (d.startDate && today < d.startDate.slice(0, 10)) throw new PaymentEffectError("زمان استفاده از این تخفیف هنوز شروع نشده است");
        if (d.endDate && today > d.endDate.slice(0, 10)) throw new PaymentEffectError("مهلت استفاده از این تخفیف تمام شده است");
        if (d.minAmount && paymentValues.originalAmount < d.minAmount) {
          throw new PaymentEffectError(`حداقل مبلغ برای این تخفیف ${fa(d.minAmount)} تومان است`);
        }
        const used = await tx.update(discountsTable)
          .set({ usageCount: sql`${discountsTable.usageCount} + 1` })
          .where(and(
            eq(discountsTable.id, d.id),
            or(isNull(discountsTable.usageLimit), lt(discountsTable.usageCount, discountsTable.usageLimit)),
          ))
          .returning({ id: discountsTable.id });
        if (used.length === 0) throw new PaymentEffectError("ظرفیت استفاده از این تخفیف تمام شده است");
        const base = paymentValues.originalAmount;
        const discountAmount = d.type === "percentage" ? Math.round((base * d.value) / 100) : Math.min(d.value, base);
        discountFields = { discountId: d.id, discountName: d.name, discountAmount: discountAmount > 0 ? discountAmount : null };
      }

      const [created] = await tx.insert(paymentsTable).values({
        ...paymentValues,
        ...discountFields,
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
      autoAccrual = await accrueReferrerCommission(tx, { payment: created, patient: paymentPatient });

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
        const state = await appointmentPaymentState(tx, appt.id);
        const changes: Partial<typeof appointmentsTable.$inferInsert> = { price };
        if (typeof created.unitsUsed === "number" && created.unitsUsed > 0) changes.unitsUsed = Math.round(created.unitsUsed);
        if (state.paid >= price && appt.status !== "cancelled") changes.status = "completed";
        await tx.update(appointmentsTable).set(changes).where(eq(appointmentsTable.id, appt.id));
      }

      return created;
    });
  } catch (err) {
    if (err instanceof PaymentEffectError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof Error && err.message === LOYALTY_ERRORS.disabled) {
      res.status(400).json({ error: "باشگاه مشتریان فعال نیست" });
      return;
    }
    if (err instanceof Error && err.message === LOYALTY_ERRORS.minRedeem) {
      res.status(400).json({ error: "امتیاز کمتر از حداقلِ قابل استفاده است" });
      return;
    }
    if (err instanceof Error && err.message === LOYALTY_ERRORS.insufficient) {
      res.status(400).json({ error: "امتیاز باشگاه کافی نیست" });
      return;
    }
    throw err;
  }

  // پیامک اطلاع پورسانت خودکار معرف — آتش و فراموش
  fireReferrerCommissionSms(autoAccrual as ReferrerAccrual | null);

  // پیامک اطلاع کمیسیون/اعتبار معرفی دستی — آتش و فراموش
  const manual = manualDone as ManualDone | null;
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
  const loyaltyResult = membership as (MembershipUpdate & { earned: number }) | null;
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
