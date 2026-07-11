import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, waitingListTable, patientsTable, servicesTable } from "@workspace/db";
import {
  ListWaitingListQueryParams,
  CreateWaitingEntryBody,
  UpdateWaitingEntryParams,
  UpdateWaitingEntryBody,
  DeleteWaitingEntryParams,
  NotifyWaitingEntryParams,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity";
import { sendSms, formatShamsiDateForSms } from "../lib/sms";

const router: IRouter = Router();

const entryWithDetails = {
  id: waitingListTable.id,
  patientId: waitingListTable.patientId,
  serviceId: waitingListTable.serviceId,
  preferredFrom: waitingListTable.preferredFrom,
  preferredTo: waitingListTable.preferredTo,
  note: waitingListTable.note,
  status: waitingListTable.status,
  appointmentId: waitingListTable.appointmentId,
  createdAt: waitingListTable.createdAt,
  patientName: patientsTable.name,
  patientPhone: patientsTable.phone,
  patientFileNumber: patientsTable.fileNumber,
  patientTier: patientsTable.tier,
  serviceName: servicesTable.name,
};

async function selectEntry(id: number) {
  const [row] = await db
    .select(entryWithDetails)
    .from(waitingListTable)
    .leftJoin(patientsTable, eq(waitingListTable.patientId, patientsTable.id))
    .leftJoin(servicesTable, eq(waitingListTable.serviceId, servicesTable.id))
    .where(eq(waitingListTable.id, id));
  return row;
}

router.get("/waiting-list", async (req, res): Promise<void> => {
  const query = ListWaitingListQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { status } = query.data;
  const whereClause = status ? eq(waitingListTable.status, status) : undefined;

  const rows = await db
    .select(entryWithDetails)
    .from(waitingListTable)
    .leftJoin(patientsTable, eq(waitingListTable.patientId, patientsTable.id))
    .leftJoin(servicesTable, eq(waitingListTable.serviceId, servicesTable.id))
    .where(whereClause)
    .orderBy(desc(waitingListTable.createdAt), desc(waitingListTable.id));

  const totalRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(waitingListTable)
    .where(whereClause);

  res.json({ data: rows, total: Number(totalRows[0].count) });
});

router.post("/waiting-list", async (req, res): Promise<void> => {
  const parsed = CreateWaitingEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [created] = await db.insert(waitingListTable).values(parsed.data).returning();
  const detail = await selectEntry(created.id);
  await logActivity("create", "waiting_list", created.id, `«${detail?.patientName ?? ""}» به لیست انتظار اضافه شد`);
  res.status(201).json(detail);
});

router.put("/waiting-list/:id", async (req, res): Promise<void> => {
  const params = UpdateWaitingEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateWaitingEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.status && !["waiting", "fulfilled", "cancelled"].includes(parsed.data.status)) {
    res.status(400).json({ error: "وضعیت نامعتبر است" });
    return;
  }
  const [updated] = await db
    .update(waitingListTable)
    .set(parsed.data)
    .where(eq(waitingListTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "مورد لیست انتظار یافت نشد" });
    return;
  }
  const detail = await selectEntry(updated.id);
  if (parsed.data.status === "fulfilled") {
    await logActivity("update", "waiting_list", updated.id, `لیست انتظار «${detail?.patientName ?? ""}» به نوبت تبدیل شد`);
  }
  res.json(detail);
});

router.delete("/waiting-list/:id", async (req, res): Promise<void> => {
  const params = DeleteWaitingEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(waitingListTable)
    .where(eq(waitingListTable.id, params.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "مورد لیست انتظار یافت نشد" });
    return;
  }
  res.sendStatus(204);
});

// اطلاع‌رسانی جای خالی — با کلیک منشی ارسال می‌شود و نتیجه به او برمی‌گردد.
// متن آزاد است و طبق قرارداد پنل، همیشه از خط عادی می‌رود (پترن متن آزاد ندارد).
// sendSms هرگز خطا پرتاب نمی‌کند و خودش نتیجه را در تاریخچه پیامک ثبت می‌کند.
router.post("/waiting-list/:id/notify", async (req, res): Promise<void> => {
  const params = NotifyWaitingEntryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const entry = await selectEntry(params.data.id);
  if (!entry) {
    res.status(404).json({ error: "مورد لیست انتظار یافت نشد" });
    return;
  }

  const name = entry.patientName ?? "";
  const service = entry.serviceName ? ` برای ${entry.serviceName}` : "";
  const range = entry.preferredFrom
    ? ` (تاریخ موردنظر شما: ${formatShamsiDateForSms(entry.preferredFrom)}${entry.preferredTo && entry.preferredTo !== entry.preferredFrom ? ` تا ${formatShamsiDateForSms(entry.preferredTo)}` : ""})`
    : "";
  const text = `${name} عزیز، جای خالی${service} در مطب زیبایی دکتر یاری آزاد شد${range}. برای رزرو نوبت لطفاً با ما تماس بگیرید.\nwww.drjavadyari.ir`;

  const result = await sendSms({
    to: entry.patientPhone ?? "",
    text,
    eventType: "waiting_list",
    recipientName: entry.patientName,
    patientId: entry.patientId,
  });

  if (result.ok) {
    await logActivity("create", "sms", entry.id, `پیامک اطلاع‌رسانی جای خالی برای «${name}» ارسال شد`);
  }
  res.json({ ok: result.ok, error: result.error ?? null });
});

export default router;
