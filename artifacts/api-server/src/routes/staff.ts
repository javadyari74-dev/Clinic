import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, staffTable } from "@workspace/db";
import {
  CreateStaffBody,
  UpdateStaffParams,
  UpdateStaffBody,
  DeleteStaffParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/staff", async (_req, res): Promise<void> => {
  const rows = await db.select().from(staffTable).orderBy(staffTable.name);
  res.json(rows);
});

router.post("/staff", async (req, res): Promise<void> => {
  const parsed = CreateStaffBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [member] = await db.insert(staffTable).values(parsed.data).returning();
  res.status(201).json(member);
});

router.put("/staff/:id", async (req, res): Promise<void> => {
  const params = UpdateStaffParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateStaffBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [member] = await db.update(staffTable).set(parsed.data).where(eq(staffTable.id, params.data.id)).returning();
  if (!member) {
    res.status(404).json({ error: "کارمند یافت نشد" });
    return;
  }
  res.json(member);
});

router.delete("/staff/:id", async (req, res): Promise<void> => {
  const params = DeleteStaffParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [member] = await db.delete(staffTable).where(eq(staffTable.id, params.data.id)).returning();
  if (!member) {
    res.status(404).json({ error: "کارمند یافت نشد" });
    return;
  }
  res.sendStatus(204);
});

export default router;
