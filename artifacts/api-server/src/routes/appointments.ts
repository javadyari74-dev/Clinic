import { Router, type IRouter } from "express";
import { eq, desc, and, gte, lt, sql, isNull, inArray } from "drizzle-orm";
import { db, appointmentsTable, patientsTable, servicesTable, staffTable, paymentsTable } from "@workspace/db";
import {
  ListAppointmentsQueryParams,
  CreateAppointmentBody,
  GetAppointmentParams,
  UpdateAppointmentParams,
  UpdateAppointmentBody,
  DeleteAppointmentParams,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity";
import { generateUniqueAppointmentCode } from "../lib/appointment-code";

const router: IRouter = Router();

const appointmentWithDetails = {
  id: appointmentsTable.id,
  appointmentCode: appointmentsTable.appointmentCode,
  patientId: appointmentsTable.patientId,
  serviceId: appointmentsTable.serviceId,
  staffId: appointmentsTable.staffId,
  scheduledAt: appointmentsTable.scheduledAt,
  status: appointmentsTable.status,
  notes: appointmentsTable.notes,
  price: appointmentsTable.price,
  discountId: appointmentsTable.discountId,
  originalPrice: appointmentsTable.originalPrice,
  deposit: appointmentsTable.deposit,
  sessionNumber: appointmentsTable.sessionNumber,
  createdAt: appointmentsTable.createdAt,
  patientName: patientsTable.name,
  patientPhone: patientsTable.phone,
  patientFileNumber: patientsTable.fileNumber,
  patientTier: patientsTable.tier,
  serviceName: servicesTable.name,
  servicePrice: sql<number>`CASE WHEN ${servicesTable.priceMode} = 'per_unit' THEN ${servicesTable.price} * coalesce(${appointmentsTable.unitsUsed}, ${servicesTable.unitCount}, 1) ELSE ${servicesTable.price} END`,
  serviceCode: servicesTable.serviceCode,
  staffName: staffTable.name,
  unitsUsed: appointmentsTable.unitsUsed,
  priceMode: servicesTable.priceMode,
  unitPrice: servicesTable.price,
  unitLabel: servicesTable.unitLabel,
  serviceUnitCount: servicesTable.unitCount,
};

router.get("/appointments/today/waiting-list", async (_req, res): Promise<void> => {
  const now = Math.floor(Date.now() / 1000);
  const startOfDay = now - (now % 86400);
  const endOfDay = startOfDay + 86400;

  const rows = await db
    .select(appointmentWithDetails)
    .from(appointmentsTable)
    .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .leftJoin(servicesTable, eq(appointmentsTable.serviceId, servicesTable.id))
    .leftJoin(staffTable, eq(appointmentsTable.staffId, staffTable.id))
    .where(and(
      gte(appointmentsTable.scheduledAt, startOfDay),
      lt(appointmentsTable.scheduledAt, endOfDay)
    ))
    .orderBy(appointmentsTable.scheduledAt);

  res.json({ data: rows, total: rows.length });
});

router.get("/appointments", async (req, res): Promise<void> => {
  const query = ListAppointmentsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { date, status, patientId, staffId, page = 1, limit = 500 } = query.data;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (status) conditions.push(eq(appointmentsTable.status, status));
  if (patientId) conditions.push(eq(appointmentsTable.patientId, patientId));
  if (staffId) conditions.push(eq(appointmentsTable.staffId, staffId));
  if (date) {
    const d = new Date(date);
    const start = Math.floor(d.getTime() / 1000);
    const end = start + 86400;
    conditions.push(gte(appointmentsTable.scheduledAt, start));
    conditions.push(lt(appointmentsTable.scheduledAt, end));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select(appointmentWithDetails)
    .from(appointmentsTable)
    .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .leftJoin(servicesTable, eq(appointmentsTable.serviceId, servicesTable.id))
    .leftJoin(staffTable, eq(appointmentsTable.staffId, staffTable.id))
    .where(whereClause)
    .orderBy(desc(appointmentsTable.scheduledAt))
    .limit(limit)
    .offset(offset);

  const totalRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(appointmentsTable)
    .where(whereClause);

  res.json({ data: rows, total: Number(totalRows[0].count) });
});

router.post("/appointments", async (req, res): Promise<void> => {
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select({ count: sql<number>`count(*)` })
    .from(appointmentsTable)
    .where(and(
      eq(appointmentsTable.patientId, parsed.data.patientId),
      eq(appointmentsTable.serviceId, parsed.data.serviceId)
    ));
  const sessionNumber = Number(existing[0].count) + 1;

  const appointmentCode = await generateUniqueAppointmentCode();

  const [appt] = await db
    .insert(appointmentsTable)
    .values({ ...parsed.data, sessionNumber, appointmentCode })
    .returning();

  const [detail] = await db
    .select(appointmentWithDetails)
    .from(appointmentsTable)
    .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .leftJoin(servicesTable, eq(appointmentsTable.serviceId, servicesTable.id))
    .leftJoin(staffTable, eq(appointmentsTable.staffId, staffTable.id))
    .where(eq(appointmentsTable.id, appt.id));

  // بیعانه نیز یک تراکنش صندوق است — با جزئیات کامل تا در رسید/صندوق و پشتیبان‌گیری بماند
  if (appt.deposit && appt.deposit > 0) {
    const paidAt = Math.floor(Date.now() / 1000);
    await db.insert(paymentsTable).values({
      appointmentId: appt.id,
      amount: appt.deposit,
      originalAmount: appt.deposit,
      method: "cash",
      notes: "بیعانه",
      patientName: detail?.patientName ?? null,
      serviceName: detail?.serviceName ?? null,
      sessionNumber: detail?.sessionNumber ?? null,
      unitLabel: detail?.unitLabel ?? null,
      paidAt,
    });
  }

  await logActivity("create", "appointment", appt.id, `نوبت جدید ${appointmentCode} برای "${detail?.patientName ?? ''}" ثبت شد`);
  res.status(201).json(detail);
});

router.get("/appointments/:id", async (req, res): Promise<void> => {
  const params = GetAppointmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select(appointmentWithDetails)
    .from(appointmentsTable)
    .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .leftJoin(servicesTable, eq(appointmentsTable.serviceId, servicesTable.id))
    .leftJoin(staffTable, eq(appointmentsTable.staffId, staffTable.id))
    .where(eq(appointmentsTable.id, params.data.id));

  if (!row) {
    res.status(404).json({ error: "نوبت یافت نشد" });
    return;
  }
  res.json(row);
});

router.delete("/appointments/bulk", async (req, res): Promise<void> => {
  const body = req.body as { ids?: unknown };
  const ids = Array.isArray(body?.ids) && body.ids.length > 0 && body.ids.every((id: unknown) => Number.isInteger(id) && (id as number) > 0)
    ? (body.ids as number[])
    : null;
  if (!ids) {
    res.status(400).json({ error: "آرایه‌ای از شناسه‌های معتبر ارسال کنید" });
    return;
  }
  const deleted = await db.delete(appointmentsTable).where(inArray(appointmentsTable.id, ids)).returning({ id: appointmentsTable.id });
  await logActivity("delete", "appointment", 0, `${deleted.length} نوبت به‌صورت دسته‌جمعی حذف شدند`);
  res.json({ deleted: deleted.length });
});

router.put("/appointments/:id", async (req, res): Promise<void> => {
  const params = UpdateAppointmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAppointmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [appt] = await db
    .update(appointmentsTable)
    .set(parsed.data)
    .where(eq(appointmentsTable.id, params.data.id))
    .returning();
  if (!appt) {
    res.status(404).json({ error: "نوبت یافت نشد" });
    return;
  }
  if (parsed.data.status) {
    await logActivity("update", "appointment", appt.id, `وضعیت نوبت به "${parsed.data.status}" تغییر کرد`);
  }
  const [detail] = await db
    .select(appointmentWithDetails)
    .from(appointmentsTable)
    .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .leftJoin(servicesTable, eq(appointmentsTable.serviceId, servicesTable.id))
    .leftJoin(staffTable, eq(appointmentsTable.staffId, staffTable.id))
    .where(eq(appointmentsTable.id, appt.id));
  res.json(detail);
});

router.delete("/appointments/:id", async (req, res): Promise<void> => {
  const params = DeleteAppointmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [appt] = await db
    .delete(appointmentsTable)
    .where(eq(appointmentsTable.id, params.data.id))
    .returning();
  if (!appt) {
    res.status(404).json({ error: "نوبت یافت نشد" });
    return;
  }
  res.sendStatus(204);
});

export { buildAppointmentCode };
export default router;
