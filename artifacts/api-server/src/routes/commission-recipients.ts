import { Router, type IRouter } from "express";
import { eq, and, or, inArray, sql } from "drizzle-orm";
import { db, commissionRecipientsTable, commissionsTable, patientsTable, appointmentsTable, paymentsTable } from "@workspace/db";
import {
  CreateCommissionRecipientBody,
  UpdateCommissionRecipientParams,
  UpdateCommissionRecipientBody,
  DeleteCommissionRecipientParams,
  GetCommissionRecipientReferralsParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/commission-recipients", async (_req, res): Promise<void> => {
  const rows = await db.select().from(commissionRecipientsTable).orderBy(commissionRecipientsTable.name);
  res.json(rows);
});

router.post("/commission-recipients", async (req, res): Promise<void> => {
  const parsed = CreateCommissionRecipientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [recipient] = await db.insert(commissionRecipientsTable).values(parsed.data).returning();
  res.status(201).json(recipient);
});

router.put("/commission-recipients/:id", async (req, res): Promise<void> => {
  const params = UpdateCommissionRecipientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCommissionRecipientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [recipient] = await db.update(commissionRecipientsTable).set(parsed.data).where(eq(commissionRecipientsTable.id, params.data.id)).returning();
  if (!recipient) {
    res.status(404).json({ error: "گیرنده یافت نشد" });
    return;
  }
  res.json(recipient);
});

router.delete("/commission-recipients/:id", async (req, res): Promise<void> => {
  const params = DeleteCommissionRecipientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [recipient] = await db.delete(commissionRecipientsTable).where(eq(commissionRecipientsTable.id, params.data.id)).returning();
  if (!recipient) {
    res.status(404).json({ error: "گیرنده یافت نشد" });
    return;
  }
  res.sendStatus(204);
});

// پرونده‌ی کمیسیون‌گیرنده: بیماران معرفی‌شده + جمع هزینه و پورسانت
router.get("/commission-recipients/:id/referrals", async (req, res): Promise<void> => {
  const params = GetCommissionRecipientReferralsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [recipient] = await db.select().from(commissionRecipientsTable).where(eq(commissionRecipientsTable.id, params.data.id));
  if (!recipient) {
    res.status(404).json({ error: "گیرنده یافت نشد" });
    return;
  }

  // بیمارانی که این گیرنده (به‌عنوان کمیسیون‌گیرنده یا لیزر) معرفشان است
  const patients = await db
    .select({ id: patientsTable.id, name: patientsTable.name, fileNumber: patientsTable.fileNumber, referrerRate: patientsTable.referrerRate })
    .from(patientsTable)
    .where(and(
      eq(patientsTable.referrerId, params.data.id),
      or(eq(patientsTable.referrerType, "recipient"), eq(patientsTable.referrerType, "laser")),
    ));

  // جمع هزینه‌ی پرداختی هر بیمار (از طریق نوبت‌ها)
  const spentByPatient = new Map<number, number>();
  // پورسانتِ واقعیِ ثبت‌شده در جدول کمیسیون‌ها برای هر بیمار (منبعِ درست، نه محاسبه‌ی دوباره از نرخِ فعلی)
  const commissionByPatient = new Map<number, { amount: number; rate: number | null }>();
  if (patients.length > 0) {
    const ids = patients.map((p) => p.id);
    const spentRows = await db
      .select({ patientId: appointmentsTable.patientId, total: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)` })
      .from(paymentsTable)
      .innerJoin(appointmentsTable, eq(paymentsTable.appointmentId, appointmentsTable.id))
      .where(inArray(appointmentsTable.patientId, ids))
      .groupBy(appointmentsTable.patientId);
    for (const r of spentRows) spentByPatient.set(r.patientId, Number(r.total) || 0);

    // کمیسیون‌های ثبت‌شده‌ی این گیرنده (نوع external) به تفکیک بیمار، از طریق نوبتِ کمیسیون
    const commRows = await db
      .select({
        patientId: appointmentsTable.patientId,
        amount: commissionsTable.amount,
        rate: commissionsTable.rate,
        createdAt: commissionsTable.createdAt,
      })
      .from(commissionsTable)
      .innerJoin(appointmentsTable, eq(commissionsTable.appointmentId, appointmentsTable.id))
      .where(and(
        eq(commissionsTable.recipientType, "external"),
        eq(commissionsTable.recipientId, params.data.id),
        inArray(appointmentsTable.patientId, ids),
      ));
    // جمعِ مبلغ + نرخِ آخرین کمیسیونِ ثبت‌شده (بر اساس createdAt) برای نمایش
    const latestRateAt = new Map<number, number>();
    for (const r of commRows) {
      const acc = commissionByPatient.get(r.patientId) ?? { amount: 0, rate: null };
      acc.amount += Number(r.amount) || 0;
      const created = Number(r.createdAt) || 0;
      if (r.rate != null && created >= (latestRateAt.get(r.patientId) ?? -1)) {
        acc.rate = Number(r.rate);
        latestRateAt.set(r.patientId, created);
      }
      commissionByPatient.set(r.patientId, acc);
    }
  }

  let totalSpent = 0;
  let totalCommission = 0;
  const referrals = patients.map((p) => {
    const spent = spentByPatient.get(p.id) ?? 0;
    const recorded = commissionByPatient.get(p.id);
    const commission = recorded?.amount ?? 0;
    // نرخِ نمایش‌داده‌شده فقط از کمیسیونِ ثبت‌شده؛ در نبودِ کمیسیون خالی می‌ماند
    const referrerRate = recorded?.rate ?? null;
    totalSpent += spent;
    totalCommission += commission;
    return {
      patientId: p.id,
      name: p.name,
      fileNumber: p.fileNumber,
      totalSpent: spent,
      referrerRate,
      commission,
    };
  });

  res.json({ recipient, referrals, totalSpent, totalCommission, count: referrals.length });
});

export default router;
