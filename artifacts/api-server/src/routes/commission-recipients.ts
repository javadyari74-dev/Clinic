import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, commissionRecipientsTable } from "@workspace/db";
import {
  CreateCommissionRecipientBody,
  UpdateCommissionRecipientParams,
  UpdateCommissionRecipientBody,
  DeleteCommissionRecipientParams,
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

export default router;
