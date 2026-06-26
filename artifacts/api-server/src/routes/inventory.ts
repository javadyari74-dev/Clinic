import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, inventoryTable } from "@workspace/db";
import {
  CreateInventoryItemBody,
  UpdateInventoryItemParams,
  UpdateInventoryItemBody,
  DeleteInventoryItemParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/inventory", async (_req, res): Promise<void> => {
  const rows = await db.select().from(inventoryTable).orderBy(inventoryTable.name);
  res.json(rows);
});

router.post("/inventory", async (req, res): Promise<void> => {
  const parsed = CreateInventoryItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updatedAt = Math.floor(Date.now() / 1000);
  const [item] = await db.insert(inventoryTable).values({ ...parsed.data, updatedAt }).returning();
  res.status(201).json(item);
});

router.put("/inventory/:id", async (req, res): Promise<void> => {
  const params = UpdateInventoryItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateInventoryItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updatedAt = Math.floor(Date.now() / 1000);
  const [item] = await db.update(inventoryTable).set({ ...parsed.data, updatedAt }).where(eq(inventoryTable.id, params.data.id)).returning();
  if (!item) {
    res.status(404).json({ error: "آیتم انبار یافت نشد" });
    return;
  }
  res.json(item);
});

router.delete("/inventory/:id", async (req, res): Promise<void> => {
  const params = DeleteInventoryItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [item] = await db.delete(inventoryTable).where(eq(inventoryTable.id, params.data.id)).returning();
  if (!item) {
    res.status(404).json({ error: "آیتم انبار یافت نشد" });
    return;
  }
  res.sendStatus(204);
});

export default router;
