import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, remindersTable, patientsTable } from "@workspace/db";
import {
  ListRemindersQueryParams,
  CreateReminderBody,
  UpdateReminderParams,
  UpdateReminderBody,
  DeleteReminderParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/reminders", async (req, res): Promise<void> => {
  const query = ListRemindersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { status, type } = query.data;

  const conditions = [];
  if (status) conditions.push(eq(remindersTable.status, status));
  if (type) conditions.push(eq(remindersTable.type, type));

  const rows = await db
    .select({
      id: remindersTable.id,
      title: remindersTable.title,
      description: remindersTable.description,
      type: remindersTable.type,
      patientId: remindersTable.patientId,
      dueAt: remindersTable.dueAt,
      status: remindersTable.status,
      createdAt: remindersTable.createdAt,
      patientName: patientsTable.name,
    })
    .from(remindersTable)
    .leftJoin(patientsTable, eq(remindersTable.patientId, patientsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(remindersTable.dueAt);

  res.json(rows);
});

router.post("/reminders", async (req, res): Promise<void> => {
  const parsed = CreateReminderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [reminder] = await db.insert(remindersTable).values(parsed.data).returning();
  res.status(201).json({ ...reminder, patientName: null });
});

router.put("/reminders/:id", async (req, res): Promise<void> => {
  const params = UpdateReminderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateReminderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [reminder] = await db.update(remindersTable).set(parsed.data).where(eq(remindersTable.id, params.data.id)).returning();
  if (!reminder) {
    res.status(404).json({ error: "یادآوری یافت نشد" });
    return;
  }
  res.json({ ...reminder, patientName: null });
});

router.delete("/reminders/:id", async (req, res): Promise<void> => {
  const params = DeleteReminderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [reminder] = await db.delete(remindersTable).where(eq(remindersTable.id, params.data.id)).returning();
  if (!reminder) {
    res.status(404).json({ error: "یادآوری یافت نشد" });
    return;
  }
  res.sendStatus(204);
});

export default router;
