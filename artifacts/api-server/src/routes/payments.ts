import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, paymentsTable, discountsTable, appointmentsTable, patientsTable, commissionsTable, patientAccountTransactionsTable } from "@workspace/db";
import {
  ListPaymentsQueryParams,
  CreatePaymentBody,
  GetPaymentParams,
  DeletePaymentParams,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity";

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
  // جزئیات کامل پرداخت (مراجع، خدمت، شماره جلسه، تخفیف، بیعانه و...) روی همین ردیف ذخیره می‌شود
  // تا هر تراکنش به‌صورت دائمی و کامل در صندوق ثبت بماند و در پشتیبان‌گیری بیاید
  const [payment] = await db.insert(paymentsTable).values({ ...parsed.data, paidAt }).returning();

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

  // ── تنها نقطه‌ی محاسبه‌ی پورسانت/اعتبار معرف برای هر پرداخت ──────────────────
  // اگر بیمارِ این پرداخت معرف داشته باشد، درصدِ تعیین‌شده روی مبلغ دریافتی محاسبه می‌شود:
  //   • معرفِ بیمار (مراجع) → اعتبار به حساب همان بیمارِ معرف اضافه می‌شود
  //   • کارمند/کمیسیون‌گیرنده/لیزر → یک ردیف کمیسیون ثبت می‌شود
  if (payment.appointmentId && payment.appointmentId > 0) {
    const [appt] = await db.select({ patientId: appointmentsTable.patientId }).from(appointmentsTable).where(eq(appointmentsTable.id, payment.appointmentId));
    if (appt) {
      const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, appt.patientId));
      if (patient && patient.referrerType && patient.referrerId && patient.referrerRate && patient.referrerRate > 0 && payment.amount > 0) {
        const accrual = Math.round((payment.amount * patient.referrerRate) / 100);
        if (accrual > 0) {
          if (patient.referrerType === "patient") {
            // اعتبار به حساب بیمارِ معرف
            const [referrer] = await db.select().from(patientsTable).where(eq(patientsTable.id, patient.referrerId));
            if (referrer) {
              await db.insert(patientAccountTransactionsTable).values({
                patientId: referrer.id,
                amount: accrual,
                type: "referral_credit",
                description: `اعتبار معرفی از پرداخت بیمار «${patient.name}»`,
                paymentId: payment.id,
              });
              await db.update(patientsTable).set({ accountBalance: referrer.accountBalance + accrual }).where(eq(patientsTable.id, referrer.id));
            }
          } else {
            // کمیسیون برای کارمند (staff) یا کمیسیون‌گیرنده/لیزر (external)
            const recipientType = patient.referrerType === "staff" ? "staff" : "external";
            await db.insert(commissionsTable).values({
              recipientType,
              recipientId: patient.referrerId,
              appointmentId: payment.appointmentId,
              amount: accrual,
              rate: patient.referrerRate,
              description: `پورسانت معرفی بیمار «${patient.name}»`,
            });
          }
        }
      }
    }
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
  const [payment] = await db.delete(paymentsTable).where(eq(paymentsTable.id, params.data.id)).returning();
  if (!payment) {
    res.status(404).json({ error: "پرداخت یافت نشد" });
    return;
  }
  res.sendStatus(204);
});

export default router;
