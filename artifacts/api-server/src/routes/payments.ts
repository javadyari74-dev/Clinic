import { Router, type IRouter } from "express";
import { eq, desc, sql, and, ne, isNull } from "drizzle-orm";
import { db, paymentsTable, discountsTable, appointmentsTable, patientsTable, commissionsTable, commissionRecipientsTable, staffTable, patientAccountTransactionsTable } from "@workspace/db";
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
  reverseLoyaltyForPayment,
  LOYALTY_ERRORS,
} from "../lib/loyalty";

const router: IRouter = Router();

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
  // applyAccountBalance و redeemPoints فقط ورودی‌اند و ستونی در جدول پرداخت ندارند؛ از داده‌ی ذخیره‌شونده جدا می‌شوند
  const { applyAccountBalance, redeemPoints, ...paymentValues } = parsed.data;
  const balanceToApply = Math.abs(Math.round(applyAccountBalance ?? 0));
  const pointsToRedeem = Math.max(0, Math.round(redeemPoints ?? 0));

  // اگر قرار است از موجودی اکانت استفاده شود، بیمار را پیدا کن و کفایت موجودی را پیش از ثبت پرداخت بررسی کن
  // تا «ثبت پرداخت» و «کسر موجودی» اتمیک باشند (یا هر دو انجام می‌شوند یا هیچ‌کدام)
  let balancePatientId: number | null = null;
  if (balanceToApply > 0) {
    if (!paymentValues.appointmentId || paymentValues.appointmentId <= 0) {
      res.status(400).json({ error: "برای کسر از موجودی اکانت، نوبت مرتبط لازم است" });
      return;
    }
    const [apptForBalance] = await db
      .select({ patientId: appointmentsTable.patientId })
      .from(appointmentsTable)
      .where(eq(appointmentsTable.id, paymentValues.appointmentId));
    if (!apptForBalance) {
      res.status(400).json({ error: "نوبت مرتبط برای کسر از موجودی اکانت یافت نشد" });
      return;
    }
    const [balancePatient] = await db
      .select({ id: patientsTable.id, accountBalance: patientsTable.accountBalance })
      .from(patientsTable)
      .where(eq(patientsTable.id, apptForBalance.patientId));
    if (!balancePatient) {
      res.status(400).json({ error: "بیمار مرتبط برای کسر از موجودی اکانت یافت نشد" });
      return;
    }
    if (balanceToApply > balancePatient.accountBalance) {
      res.status(400).json({ error: "موجودی اکانت کافی نیست" });
      return;
    }
    balancePatientId = balancePatient.id;
  }

  // ── باشگاه مشتریان: بیمارِ پرداخت را برای کسب/خرج امتیاز پیدا کن ──
  // کسب امتیاز و استفاده از امتیاز داخل تراکنشِ همان پرداخت انجام می‌شود (اتمیک).
  const loyaltySettings = await getLoyaltySettings();
  let loyaltyPatientId: number | null = null;
  if (paymentValues.appointmentId && paymentValues.appointmentId > 0 && (loyaltySettings.enabled || pointsToRedeem > 0)) {
    const [apptForLoyalty] = await db
      .select({ patientId: appointmentsTable.patientId })
      .from(appointmentsTable)
      .where(eq(appointmentsTable.id, paymentValues.appointmentId));
    loyaltyPatientId = apptForLoyalty?.patientId ?? null;
  }
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

  // جزئیات کامل پرداخت (مراجع، خدمت، شماره جلسه، تخفیف، بیعانه و...) روی همین ردیف ذخیره می‌شود
  // تا هر تراکنش به‌صورت دائمی و کامل در صندوق ثبت بماند و در پشتیبان‌گیری بیاید
  // ثبت پرداخت و کسر موجودی اکانت در یک تراکنش انجام می‌شود تا اتمیک بماند
  const payment = await db.transaction(async (tx) => {
    const [created] = await tx.insert(paymentsTable).values({ ...paymentValues, paidAt }).returning();

    if (balanceToApply > 0 && balancePatientId !== null) {
      const [freshPatient] = await tx
        .select({ accountBalance: patientsTable.accountBalance })
        .from(patientsTable)
        .where(eq(patientsTable.id, balancePatientId));
      if (!freshPatient || balanceToApply > freshPatient.accountBalance) {
        // در صورت تغییر موجودی بین بررسی اولیه و این لحظه، کل تراکنش برگردانده می‌شود
        throw new Error("INSUFFICIENT_BALANCE");
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
      await applyLoyaltyOnPayment(tx, {
        patientId: loyaltyPatientId,
        paymentId: created.id,
        amountPaid: created.amount,
        redeemPoints: pointsToRedeem,
        settings: loyaltySettings,
        serviceName: created.serviceName,
      });
    }

    return created;
  }).catch((err: unknown) => {
    if (err instanceof Error && err.message === "INSUFFICIENT_BALANCE") {
      res.status(400).json({ error: "موجودی اکانت کافی نیست" });
      return null;
    }
    if (err instanceof Error && err.message === LOYALTY_ERRORS.disabled) {
      res.status(400).json({ error: "باشگاه مشتریان فعال نیست" });
      return null;
    }
    if (err instanceof Error && err.message === LOYALTY_ERRORS.minRedeem) {
      res.status(400).json({ error: "امتیاز کمتر از حداقلِ قابل استفاده است" });
      return null;
    }
    if (err instanceof Error && err.message === LOYALTY_ERRORS.insufficient) {
      res.status(400).json({ error: "امتیاز باشگاه کافی نیست" });
      return null;
    }
    throw err;
  });

  if (!payment) return;

  // Increment discount usage if applied
  if (payment.discountId) {
    await db.update(discountsTable)
      .set({ usageCount: sql`usage_count + 1` })
      .where(eq(discountsTable.id, payment.discountId));
  }

  // وقتی پرداخت ثبت شد، نوبت مرتبط را به «تکمیل شده» تغییر بده و واحد مصرفی را ذخیره کن
  if (payment.appointmentId && payment.appointmentId > 0) {
    await db.update(appointmentsTable)
      .set(
        typeof payment.unitsUsed === "number" && payment.unitsUsed > 0
          ? { status: "completed", unitsUsed: Math.round(payment.unitsUsed) }
          : { status: "completed" }
      )
      .where(eq(appointmentsTable.id, payment.appointmentId));
  }

  // ── محاسبه‌ی خودکار پورسانتِ معرف (کارمند/کمیسیون‌گیرنده/لیزر) برای هر پرداخت ──
  // اگر بیمارِ این پرداخت، معرفی از نوع کارمند/کمیسیون‌گیرنده/لیزر داشته باشد، درصدِ
  // تعیین‌شده روی مبلغ دریافتی محاسبه و یک ردیف کمیسیون ثبت می‌شود.
  // نکته: حالتِ «معرف از نوع مراجع» اینجا انجام نمی‌شود؛ این حالت در صندوق (بخش
  // تخصیص کمیسیون) به‌صورت دستی و با درصدِ قابل‌ویرایش انجام می‌شود تا اعتبار روی
  // حساب بیمارِ معرف شارژ شود و از دوباره‌حساب‌شدن جلوگیری شود.
  // بیمارِ مرتبط با پرداخت (برای پیامک اطلاع‌رسانی و محاسبه پورسانت معرف)
  let paymentPatient: typeof patientsTable.$inferSelect | null = null;
  if (payment.appointmentId && payment.appointmentId > 0) {
    const [appt] = await db.select({ patientId: appointmentsTable.patientId }).from(appointmentsTable).where(eq(appointmentsTable.id, payment.appointmentId));
    if (appt) {
      const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, appt.patientId));
      paymentPatient = patient ?? null;
    }
  }

  if (paymentPatient) {
    const patient = paymentPatient;
    if (
      patient.referrerType && patient.referrerType !== "patient" &&
      patient.referrerId && patient.referrerRate && patient.referrerRate > 0 && payment.amount > 0
    ) {
      const accrual = Math.round((payment.amount * patient.referrerRate) / 100);
      if (accrual > 0) {
        // کمیسیون برای کارمند (staff) یا کمیسیون‌گیرنده/لیزر (external)
        const recipientType = patient.referrerType === "staff" ? "staff" : "external";
        await db.insert(commissionsTable).values({
          recipientType,
          recipientId: patient.referrerId,
          appointmentId: payment.appointmentId,
          paymentId: payment.id,
          amount: accrual,
          rate: patient.referrerRate,
          description: `پورسانت معرفی بیمار «${patient.name}»`,
        });

        // پیامک اطلاع پورسانت برای معرف (کارمند/کمیسیون‌گیرنده) — آتش و فراموش؛
        // جستجوی گیرنده هم خارج از مسیر اصلی درخواست انجام می‌شود تا هیچ خطایی
        // ثبت پرداخت را مختل نکند.
        const referrerId = patient.referrerId;
        const referrerRate = patient.referrerRate;
        void (async () => {
          try {
            const [recipient] =
              recipientType === "staff"
                ? await db.select({ name: staffTable.name, phone: staffTable.phone }).from(staffTable).where(eq(staffTable.id, referrerId))
                : await db.select({ name: commissionRecipientsTable.name, phone: commissionRecipientsTable.phone }).from(commissionRecipientsTable).where(eq(commissionRecipientsTable.id, referrerId));
            if (recipient) {
              fireCommissionSms({
                referrerName: recipient.name,
                phone: recipient.phone,
                commissionAmount: accrual,
                baseAmount: payment.amount,
                rate: referrerRate,
              });
            }
          } catch (err) {
            logger.warn({ err }, "commission SMS recipient lookup failed");
          }
        })();
      }
    }
  }

  // پیامک اطلاع پرداخت برای بیمار — آتش و فراموش؛ خطای پیامک ثبت پرداخت را مختل نمی‌کند
  firePaymentSms({
    patientId: paymentPatient?.id ?? null,
    patientName: payment.patientName ?? paymentPatient?.name ?? null,
    phone: paymentPatient?.phone ?? null,
    amount: payment.amount,
    serviceName: payment.serviceName ?? null,
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
  // حذف پرداخت باید همه‌ی آثار مالیِ همان پرداخت را به‌صورت اتمیک برگرداند تا چیزی جا نماند:
  //   ۱) تراکنش‌های حساب مراجع مرتبط (کسر موجودی یا اعتبار معرفی) + اصلاح موجودی
  //   ۲) ردیف‌های کمیسیون ثبت‌شده برای نوبتِ همان پرداخت (پورسانت معرفِ کارمند/کمیسیون‌گیرنده/لیزر یا کمیسیون دستی)
  //   ۳) کاهش شمارش استفاده‌ی تخفیف
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

      // ۱) برگرداندن تراکنش‌های حساب: برعکس‌کردن هر تراکنش یعنی کم‌کردن «مبلغِ آن» از موجودی
      //    (کسرِ منفی → موجودی برمی‌گردد؛ اعتبارِ مثبت → از موجودی کم می‌شود)
      const linkedTxns = await tx
        .select()
        .from(patientAccountTransactionsTable)
        .where(eq(patientAccountTransactionsTable.paymentId, claimed.id));
      for (const t of linkedTxns) {
        await tx
          .update(patientsTable)
          .set({ accountBalance: sql`${patientsTable.accountBalance} - ${t.amount}` })
          .where(eq(patientsTable.id, t.patientId));
      }
      if (linkedTxns.length > 0) {
        await tx
          .delete(patientAccountTransactionsTable)
          .where(eq(patientAccountTransactionsTable.paymentId, claimed.id));
      }

      // ۲) حذف کمیسیون‌های مربوط به همین پرداخت.
      //    کمیسیون‌های جدید با paymentId به پرداخت گره خورده‌اند؛ پس دقیقاً همان‌ها حذف می‌شوند.
      await tx.delete(commissionsTable).where(eq(commissionsTable.paymentId, claimed.id));
      //    سازگاری با داده‌های قدیمی: کمیسیون‌هایی که قبل از افزودن paymentId ساخته شده‌اند
      //    فقط appointmentId دارند. این‌ها را تنها وقتی با appointmentId حذف می‌کنیم که این
      //    پرداخت تنها پرداختِ آن نوبت باشد، تا کمیسیونِ پرداخت‌های دیگرِ همان نوبت پاک نشود.
      if (claimed.appointmentId && claimed.appointmentId > 0) {
        const otherPayments = await tx
          .select({ id: paymentsTable.id })
          .from(paymentsTable)
          .where(and(eq(paymentsTable.appointmentId, claimed.appointmentId), ne(paymentsTable.id, claimed.id)));
        if (otherPayments.length === 0) {
          await tx
            .delete(commissionsTable)
            .where(and(eq(commissionsTable.appointmentId, claimed.appointmentId), isNull(commissionsTable.paymentId)));
        }
      }

      // ۳) کاهش شمارش استفاده‌ی تخفیف (هرگز منفی نشود)
      if (claimed.discountId) {
        await tx
          .update(discountsTable)
          .set({ usageCount: sql`MAX(usage_count - 1, 0)` })
          .where(eq(discountsTable.id, claimed.discountId));
      }

      // ۴) برگرداندن آثار امتیازیِ باشگاه مشتریان (کسب/خرج این پرداخت)؛ اگر امتیازِ
      //    کسب‌شده از این پرداخت قبلاً استفاده شده باشد، حذف لغو می‌شود.
      await reverseLoyaltyForPayment(tx, claimed.id);

      return claimed;
    });
  } catch (err) {
    if (err instanceof Error && err.message === PAYMENT_NOT_FOUND) {
      res.status(404).json({ error: "پرداخت یافت نشد" });
      return;
    }
    if (err instanceof Error && err.message === LOYALTY_ERRORS.negativeOnDelete) {
      res.status(400).json({ error: "امتیازهای کسب‌شده از این پرداخت قبلاً استفاده شده‌اند؛ ابتدا باید امتیازهای استفاده‌شده برگردانده شود" });
      return;
    }
    throw err;
  }

  await logActivity("delete", "payment", payment.id, `پرداخت ${payment.amount.toLocaleString()} تومان حذف شد`);
  res.sendStatus(204);
});

export default router;
