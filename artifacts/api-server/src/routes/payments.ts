import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, paymentsTable, discountsTable, appointmentsTable } from "@workspace/db";
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
