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

// فیلتر اختیاری ?patientId= برای پروندهٔ بیمار
const ListRemindersQuery = ListRemindersQueryParams.extend({
  patientId: DeleteReminderParams.shape.id.int().positive().optional(),
});

const router: IRouter = Router();

// dueAt ثانیهٔ یونیکس است؛ مقدار میلی‌ثانیه‌ای (≥ 1e11) یا سالِ خارج از ۲۰۰۰ تا ۲۱۰۰ نشانهٔ
// اشتباه واحد یا قاطی شدن سال شمسی/میلادی است و رد می‌شود.
const DUE_AT_MIN = Date.UTC(2000, 0, 1) / 1000;
const DUE_AT_MAX = Date.UTC(2101, 0, 1) / 1000;
function dueAtError(dueAt: number | undefined): string | null {
  if (dueAt === undefined) return null;
  if (!Number.isFinite(dueAt)) return "تاریخ یادآوری نامعتبر است";
  if (dueAt >= 1e11) return "تاریخ یادآوری باید به ثانیه باشد، نه میلی‌ثانیه";
  if (dueAt < DUE_AT_MIN || dueAt >= DUE_AT_MAX) return "تاریخ یادآوری باید بین سال‌های ۲۰۰۰ تا ۲۱۰۰ میلادی باشد";
  return null;
}

router.get("/reminders", async (req, res): Promise<void> => {
  const query = ListRemindersQuery.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { status, type, patientId } = query.data;

  const conditions = [];
  if (status) conditions.push(eq(remindersTable.status, status));
  if (type) conditions.push(eq(remindersTable.type, type));
  if (patientId) conditions.push(eq(remindersTable.patientId, patientId));

  const rows = await db
    .select({
      id: remindersTable.id,
      title: remindersTable.title,
      description: remindersTable.description,
      type: remindersTable.type,
      patientId: remindersTable.patientId,
      paymentId: remindersTable.paymentId,
      dueAt: remindersTable.dueAt,
      status: remindersTable.status,
      createdAt: remindersTable.createdAt,
      patientName: patientsTable.name,
      patientTier: patientsTable.tier,
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
  const dueErr = dueAtError(parsed.data.dueAt);
  if (dueErr) {
    res.status(400).json({ error: dueErr });
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
  const dueErr = dueAtError(parsed.data.dueAt);
  if (dueErr) {
    res.status(400).json({ error: dueErr });
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
