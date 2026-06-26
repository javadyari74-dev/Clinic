import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, commissionsTable, staffTable, commissionRecipientsTable } from "@workspace/db";
import {
  ListCommissionsQueryParams,
  CreateCommissionBody,
  UpdateCommissionParams,
  UpdateCommissionBody,
  DeleteCommissionParams,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity";

const router: IRouter = Router();

router.get("/commissions", async (req, res): Promise<void> => {
  const query = ListCommissionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { isPaid, recipientType, recipientId } = query.data;

  const conditions = [];
  if (isPaid !== undefined) conditions.push(eq(commissionsTable.isPaid, isPaid));
  if (recipientType) conditions.push(eq(commissionsTable.recipientType, recipientType));
  if (recipientId) conditions.push(eq(commissionsTable.recipientId, recipientId));

  const rows = await db.select().from(commissionsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`${commissionsTable.createdAt} DESC`);

  // Enrich with recipient name
  const enriched = await Promise.all(rows.map(async (row) => {
    let recipientName: string | null = null;
    if (row.recipientType === "staff") {
      const [s] = await db.select({ name: staffTable.name }).from(staffTable).where(eq(staffTable.id, row.recipientId));
      recipientName = s?.name ?? null;
    } else {
      const [r] = await db.select({ name: commissionRecipientsTable.name }).from(commissionRecipientsTable).where(eq(commissionRecipientsTable.id, row.recipientId));
      recipientName = r?.name ?? null;
    }
    return { ...row, recipientName };
  }));

  res.json(enriched);
});

router.post("/commissions", async (req, res): Promise<void> => {
  const parsed = CreateCommissionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [commission] = await db.insert(commissionsTable).values(parsed.data).returning();
  await logActivity("create", "commission", commission.id, `کمیسیون ${commission.amount.toLocaleString()} تومان ثبت شد`);
  res.status(201).json({ ...commission, recipientName: null });
});

router.put("/commissions/:id", async (req, res): Promise<void> => {
  const params = UpdateCommissionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCommissionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.isPaid && !parsed.data.paidAt) {
    updateData.paidAt = Math.floor(Date.now() / 1000);
  }

  const [commission] = await db.update(commissionsTable).set(updateData).where(eq(commissionsTable.id, params.data.id)).returning();
  if (!commission) {
    res.status(404).json({ error: "کمیسیون یافت نشد" });
    return;
  }
  if (commission.isPaid) {
    await logActivity("update", "commission", commission.id, `کمیسیون تسویه شد`);
  }
  res.json({ ...commission, recipientName: null });
});

router.delete("/commissions/:id", async (req, res): Promise<void> => {
  const params = DeleteCommissionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [commission] = await db.delete(commissionsTable).where(eq(commissionsTable.id, params.data.id)).returning();
  if (!commission) {
    res.status(404).json({ error: "کمیسیون یافت نشد" });
    return;
  }
  res.sendStatus(204);
});

export default router;
