import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, staffTable, patientsTable, commissionsTable } from "@workspace/db";
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
  // کارمندی که معرفِ مراجعی است یا پورسانت تسویه‌نشده دارد حذف نمی‌شود
  // (وگرنه مراجع به معرفِ ناموجود اشاره می‌کند و پورسانتش بی‌صاحب می‌ماند)
  const referenced = await db.select({ id: patientsTable.id }).from(patientsTable)
    .where(and(eq(patientsTable.referrerType, "staff"), eq(patientsTable.referrerId, params.data.id))).limit(1);
  if (referenced.length > 0) {
    res.status(400).json({ error: "این کارمند معرفِ یک یا چند مراجع است؛ ابتدا معرفِ آن مراجعین را تغییر دهید" });
    return;
  }
  const unpaid = await db.select({ id: commissionsTable.id }).from(commissionsTable)
    .where(and(eq(commissionsTable.recipientType, "staff"), eq(commissionsTable.recipientId, params.data.id), eq(commissionsTable.isPaid, false))).limit(1);
  if (unpaid.length > 0) {
    res.status(400).json({ error: "این کارمند پورسانت تسویه‌نشده دارد؛ ابتدا پورسانت‌ها را تسویه یا حذف کنید" });
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
