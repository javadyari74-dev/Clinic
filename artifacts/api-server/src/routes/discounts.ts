import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, discountsTable } from "@workspace/db";
import {
  CreateDiscountBody,
  UpdateDiscountParams,
  UpdateDiscountBody,
  DeleteDiscountParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/discounts", async (_req, res): Promise<void> => {
  const rows = await db.select().from(discountsTable).orderBy(discountsTable.name);
  res.json(rows);
});

router.post("/discounts", async (req, res): Promise<void> => {
  const parsed = CreateDiscountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [discount] = await db.insert(discountsTable).values(parsed.data).returning();
  res.status(201).json(discount);
});

router.put("/discounts/:id", async (req, res): Promise<void> => {
  const params = UpdateDiscountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateDiscountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [discount] = await db.update(discountsTable).set(parsed.data).where(eq(discountsTable.id, params.data.id)).returning();
  if (!discount) {
    res.status(404).json({ error: "تخفیف یافت نشد" });
    return;
  }
  res.json(discount);
});

router.delete("/discounts/:id", async (req, res): Promise<void> => {
  const params = DeleteDiscountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [discount] = await db.delete(discountsTable).where(eq(discountsTable.id, params.data.id)).returning();
  if (!discount) {
    res.status(404).json({ error: "تخفیف یافت نشد" });
    return;
  }
  res.sendStatus(204);
});

export default router;
