import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, commissionRecipientsTable, patientsTable, appointmentsTable, paymentsTable, commissionsTable } from "@workspace/db";
import {
  CreateCommissionRecipientBody,
  UpdateCommissionRecipientParams,
  UpdateCommissionRecipientBody,
  DeleteCommissionRecipientParams,
} from "@workspace/api-zod";
import { fireRecipientWelcomeSms } from "../lib/sms";

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
  // پیامک خوش‌آمد به معرف تازه‌ثبت‌شده (آتش و فراموش — جریان اصلی معطل نمی‌ماند)
  fireRecipientWelcomeSms({ name: recipient.name, phone: recipient.phone });
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

router.get("/commission-recipients/:id/referrals", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "شناسه نامعتبر است" });
    return;
  }
  const [recipient] = await db.select().from(commissionRecipientsTable).where(eq(commissionRecipientsTable.id, id));
  if (!recipient) {
    res.status(404).json({ error: "گیرنده یافت نشد" });
    return;
  }
  const referredPatients = await db.select().from(patientsTable)
    .where(and(eq(patientsTable.referrerType, "external"), eq(patientsTable.referrerId, id)));

  const referrals: Array<{
    patientId: number;
    name: string;
    fileNumber: string | null;
    totalSpent: number;
    referrerRate: number | null;
    commission: number;
  }> = [];
  let totalSpent = 0;
  let totalCommission = 0;

  for (const p of referredPatients) {
    const appts = await db.select({ id: appointmentsTable.id }).from(appointmentsTable).where(eq(appointmentsTable.patientId, p.id));
    const apptIds = appts.map((a) => a.id);
    let spent = 0;
    let commission = 0;
    if (apptIds.length) {
      const pays = await db.select({ amount: paymentsTable.amount }).from(paymentsTable).where(inArray(paymentsTable.appointmentId, apptIds));
      spent = pays.reduce((s, r) => s + (r.amount ?? 0), 0);
      const comms = await db.select({ amount: commissionsTable.amount }).from(commissionsTable)
        .where(and(eq(commissionsTable.recipientType, "external"), eq(commissionsTable.recipientId, id), inArray(commissionsTable.appointmentId, apptIds)));
      commission = comms.reduce((s, r) => s + (r.amount ?? 0), 0);
    }
    totalSpent += spent;
    totalCommission += commission;
    referrals.push({
      patientId: p.id,
      name: p.name,
      fileNumber: p.fileNumber ?? null,
      totalSpent: spent,
      referrerRate: p.referrerRate ?? null,
      commission,
    });
  }

  res.json({
    recipient: { id: recipient.id, name: recipient.name },
    count: referrals.length,
    totalSpent,
    totalCommission,
    referrals,
  });
});

export default router;
