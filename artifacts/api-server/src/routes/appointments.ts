import { Router, type IRouter } from "express";
import { eq, desc, and, gte, lt, sql, inArray, like } from "drizzle-orm";
import { db, appointmentsTable, patientsTable, servicesTable, staffTable, paymentsTable, scheduledSmsTable, waitingListTable } from "@workspace/db";
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
import { fireAppointmentSms } from "../lib/sms";
import {
  appointmentWithDetails,
  normalizeScheduledAt,
  tehranDayRangeMs,
  tehranDateRangeMs,
  nextSessionNumber,
  appointmentStatusLabel,
} from "../lib/appointment-details";
import { recordDepositPayment, fireReferrerCommissionSms, type Tx } from "../lib/payment-effects";

const HAS_PAYMENTS_MESSAGE = "این نوبت پرداخت ثبت‌شده دارد؛ ابتدا پرداخت‌ها را از صندوق حذف کنید";

// پاک‌کردن داده‌های وابسته به نوبتِ در حال حذف (داخل تراکنش حذف):
// پیامک‌های زمان‌بندی‌شدهٔ همین نوبت و ارجاع لیست انتظار به آن
async function cleanupAppointmentLinks(tx: Tx, appointmentIds: number[]): Promise<void> {
  if (appointmentIds.length === 0) return;
  for (const id of appointmentIds) {
    await tx.delete(scheduledSmsTable).where(like(scheduledSmsTable.key, `appointment:${id}:%`));
  }
  await tx.update(waitingListTable).set({ appointmentId: null }).where(inArray(waitingListTable.appointmentId, appointmentIds));
}

const router: IRouter = Router();

router.get("/appointments/today/waiting-list", async (_req, res): Promise<void> => {
  // scheduled_at میلی‌ثانیه است؛ «امروز» = روز تهران
  const { start: startOfDay, end: endOfDay } = tehranDayRangeMs(Date.now());

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
    // مرزهای روز تهران به میلی‌ثانیه (scheduled_at میلی‌ثانیه است)
    const range = tehranDateRangeMs(String(date));
    if (range) {
      conditions.push(gte(appointmentsTable.scheduledAt, range.start));
      conditions.push(lt(appointmentsTable.scheduledAt, range.end));
    }
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

  const scheduledAt = normalizeScheduledAt(parsed.data.scheduledAt);
  const appointmentCode = await generateUniqueAppointmentCode();

  // ساخت نوبت + ردیف بیعانه (و پورسانت معرف روی بیعانه) در یک تراکنش
  const { appt, accrual } = await db.transaction(async (tx) => {
    const sessionNumber = await nextSessionNumber(tx, parsed.data.patientId, parsed.data.serviceId);
    const [created] = await tx
      .insert(appointmentsTable)
      .values({ ...parsed.data, scheduledAt, sessionNumber, appointmentCode })
      .returning();
    let accrual = null;
    // بیعانه نیز یک تراکنش صندوق است — با جزئیات کامل تا در رسید/صندوق و پشتیبان‌گیری بماند
    if (created.deposit && created.deposit > 0) {
      const svc = await tx.select({ name: servicesTable.name, unitLabel: servicesTable.unitLabel })
        .from(servicesTable).where(eq(servicesTable.id, created.serviceId)).get();
      const dep = await recordDepositPayment(tx, {
        appointmentId: created.id,
        deposit: created.deposit,
        patientId: created.patientId,
        serviceName: svc?.name ?? null,
        sessionNumber: created.sessionNumber,
        unitLabel: svc?.unitLabel ?? null,
      });
      accrual = dep?.accrual ?? null;
    }
    return { appt: created, accrual };
  });
  fireReferrerCommissionSms(accrual);

  const [detail] = await db
    .select(appointmentWithDetails)
    .from(appointmentsTable)
    .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .leftJoin(servicesTable, eq(appointmentsTable.serviceId, servicesTable.id))
    .leftJoin(staffTable, eq(appointmentsTable.staffId, staffTable.id))
    .where(eq(appointmentsTable.id, appt.id));

  await logActivity("create", "appointment", appt.id, `نوبت جدید ${appointmentCode} برای "${detail?.patientName ?? ''}" ثبت شد`);

  // پیامک تأیید نوبت برای بیمار — آتش و فراموش؛ در نبود اینترنت، ثبت نوبت مختل نمی‌شود
  fireAppointmentSms({
    patientId: appt.patientId,
    patientName: detail?.patientName ?? null,
    phone: detail?.patientPhone ?? null,
    scheduledAt: appt.scheduledAt,
    serviceName: detail?.serviceName ?? null,
  });

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
  // نوبت‌هایی که پرداخت دارند حذف نمی‌شوند (تا پرداخت/کمیسیون/کیف پول یتیم نماند)
  const result = await db.transaction(async (tx) => {
    const withPayments = await tx.selectDistinct({ id: paymentsTable.appointmentId }).from(paymentsTable)
      .where(inArray(paymentsTable.appointmentId, ids));
    const skipped = withPayments.map((r) => r.id);
    const deletable = ids.filter((id) => !skipped.includes(id));
    const deleted = deletable.length > 0
      ? await tx.delete(appointmentsTable).where(inArray(appointmentsTable.id, deletable)).returning({ id: appointmentsTable.id })
      : [];
    await cleanupAppointmentLinks(tx, deleted.map((d) => d.id));
    return { deleted: deleted.length, skipped };
  });
  if (result.deleted === 0 && result.skipped.length > 0) {
    res.status(400).json({ error: `${HAS_PAYMENTS_MESSAGE} (${result.skipped.length} نوبت)`, deleted: 0, skipped: result.skipped });
    return;
  }
  await logActivity("delete", "appointment", 0, `${result.deleted} نوبت به‌صورت دسته‌جمعی حذف شدند`);
  res.json({
    deleted: result.deleted,
    skipped: result.skipped,
    ...(result.skipped.length > 0 ? { message: `${result.skipped.length} نوبت به‌دلیل داشتن پرداخت حذف نشد` } : {}),
  });
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
  const changes: typeof parsed.data & { sessionNumber?: number } = { ...parsed.data };
  if (typeof changes.scheduledAt === "number") changes.scheduledAt = normalizeScheduledAt(changes.scheduledAt);
  const appt = await db.transaction(async (tx) => {
    const current = await tx.select().from(appointmentsTable).where(eq(appointmentsTable.id, params.data.id)).get();
    if (!current) return null;
    // تغییر خدمت/مراجع → شمارهٔ جلسه برای ترکیب جدید دوباره حساب می‌شود
    const patientId = changes.patientId ?? current.patientId;
    const serviceId = changes.serviceId ?? current.serviceId;
    if (patientId !== current.patientId || serviceId !== current.serviceId) {
      changes.sessionNumber = await nextSessionNumber(tx, patientId, serviceId, current.id);
    }
    if (Object.keys(changes).length === 0) return current;
    const [updated] = await tx
      .update(appointmentsTable)
      .set(changes)
      .where(eq(appointmentsTable.id, params.data.id))
      .returning();
    return updated;
  });
  if (!appt) {
    res.status(404).json({ error: "نوبت یافت نشد" });
    return;
  }
  if (parsed.data.status) {
    await logActivity("update", "appointment", appt.id, `وضعیت نوبت به «${appointmentStatusLabel(parsed.data.status)}» تغییر کرد`);
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
  // نوبتی که پرداخت (بیعانه/تسویه) دارد حذف نمی‌شود تا پرداخت، کمیسیون و کیف پول یتیم نماند
  const NOT_FOUND = "NOT_FOUND";
  const HAS_PAYMENTS = "HAS_PAYMENTS";
  try {
    await db.transaction(async (tx) => {
      const pays = await tx.select({ id: paymentsTable.id }).from(paymentsTable)
        .where(eq(paymentsTable.appointmentId, params.data.id)).limit(1);
      if (pays.length > 0) throw new Error(HAS_PAYMENTS);
      const [deleted] = await tx.delete(appointmentsTable).where(eq(appointmentsTable.id, params.data.id)).returning();
      if (!deleted) throw new Error(NOT_FOUND);
      await cleanupAppointmentLinks(tx, [deleted.id]);
    });
  } catch (err) {
    if (err instanceof Error && err.message === NOT_FOUND) {
      res.status(404).json({ error: "نوبت یافت نشد" });
      return;
    }
    if (err instanceof Error && err.message === HAS_PAYMENTS) {
      res.status(400).json({ error: HAS_PAYMENTS_MESSAGE });
      return;
    }
    throw err;
  }
  await logActivity("delete", "appointment", params.data.id, `نوبت حذف شد`);
  res.sendStatus(204);
});

export default router;
