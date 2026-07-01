import { Router, type IRouter } from "express";
import { eq, or, and, like, desc, count, isNotNull, sql, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { patientsTable, appointmentsTable, servicesTable, staffTable, commissionRecipientsTable, patientAccountTransactionsTable, paymentsTable, patientNotesTable, remindersTable, commissionsTable } from "@workspace/db";
import {
  ListPatientsQueryParams,
  CreatePatientBody,
  GetPatientParams,
  UpdatePatientParams,
  UpdatePatientBody,
  DeletePatientParams,
  ListPatientAppointmentsParams,
  ListPatientAccountTransactionsParams,
  CreatePatientAccountTransactionParams,
  CreatePatientAccountTransactionBody,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity";
import { requireAdmin } from "../lib/auth";

const router: IRouter = Router();

type PatientRow = typeof patientsTable.$inferSelect;

// نام معرف هر بیمار را بر اساس نوع معرف (مراجع/کمیسیون‌گیرنده/کارمند/لیزر) پیدا می‌کند
async function enrichReferrerNames<T extends PatientRow>(rows: T[]): Promise<(T & { referrerName: string | null })[]> {
  const patientIds = new Set<number>();
  const recipientIds = new Set<number>();
  const staffIds = new Set<number>();
  for (const r of rows) {
    if (!r.referrerType || !r.referrerId) continue;
    if (r.referrerType === "patient") patientIds.add(r.referrerId);
    else if (r.referrerType === "staff") staffIds.add(r.referrerId);
    else recipientIds.add(r.referrerId); // recipient / laser
  }

  const patientMap = new Map<number, string>();
  const recipientMap = new Map<number, string>();
  const staffMap = new Map<number, string>();

  if (patientIds.size > 0) {
    const ps = await db.select({ id: patientsTable.id, name: patientsTable.name }).from(patientsTable).where(inArray(patientsTable.id, [...patientIds]));
    for (const p of ps) patientMap.set(p.id, p.name);
  }
  if (recipientIds.size > 0) {
    const rs = await db.select({ id: commissionRecipientsTable.id, name: commissionRecipientsTable.name }).from(commissionRecipientsTable).where(inArray(commissionRecipientsTable.id, [...recipientIds]));
    for (const r of rs) recipientMap.set(r.id, r.name);
  }
  if (staffIds.size > 0) {
    const ss = await db.select({ id: staffTable.id, name: staffTable.name }).from(staffTable).where(inArray(staffTable.id, [...staffIds]));
    for (const s of ss) staffMap.set(s.id, s.name);
  }

  return rows.map((r) => {
    let referrerName: string | null = null;
    if (r.referrerType && r.referrerId) {
      if (r.referrerType === "patient") referrerName = patientMap.get(r.referrerId) ?? null;
      else if (r.referrerType === "staff") referrerName = staffMap.get(r.referrerId) ?? null;
      else referrerName = recipientMap.get(r.referrerId) ?? null;
    }
    return { ...r, referrerName };
  });
}

router.get("/patients", async (req, res): Promise<void> => {
  const query = ListPatientsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { q, page = 1, limit = 500 } = query.data;
  const offset = (page - 1) * limit;

  let baseQuery = db.select().from(patientsTable);
  let countQuery = db.select({ count: count() }).from(patientsTable);

  if (q) {
    const where = or(
      like(patientsTable.name, `%${q}%`),
      like(patientsTable.phone, `%${q}%`),
      like(patientsTable.fileNumber, `%${q}%`)
    );
    const rows = await baseQuery.where(where).orderBy(desc(patientsTable.createdAt)).limit(limit).offset(offset);
    const [{ count: total }] = await countQuery.where(where);
    res.json({ data: await enrichReferrerNames(rows), total, page, limit });
    return;
  }

  const rows = await baseQuery.orderBy(desc(patientsTable.createdAt)).limit(limit).offset(offset);
  const [{ count: total }] = await countQuery;
  res.json({ data: await enrichReferrerNames(rows), total, page, limit });
});

router.post("/patients", async (req, res): Promise<void> => {
  const parsed = CreatePatientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [patient] = await db.insert(patientsTable).values(parsed.data).returning();
  await logActivity("create", "patient", patient.id, `بیمار جدید "${patient.name}" ثبت شد`);
  res.status(201).json(patient);
});

// ── Birthday helpers ─────────────────────────────────────────────────────────

function getShamsiPartsServer(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-persian", {
    year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(date);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function shamsiToGregorianServer(year: number, month: number, day: number): Date {
  const ref = new Date();
  ref.setHours(12, 0, 0, 0);
  const r = getShamsiPartsServer(ref);
  const approx = Math.round(
    (year - r.year) * 365.25 +
    ((month - 1) * 30.5 + day) - ((r.month - 1) * 30.5 + r.day),
  );
  const base = new Date(ref);
  base.setDate(base.getDate() + approx);
  for (let d = -8; d <= 8; d++) {
    const test = new Date(base);
    test.setDate(test.getDate() + d);
    const p = getShamsiPartsServer(test);
    if (p.year === year && p.month === month && p.day === day) return test;
  }
  return base;
}

// GET /api/patients/upcoming-birthdays?days=10
router.get("/patients/upcoming-birthdays", async (req, res): Promise<void> => {
  const daysAhead = Math.min(parseInt((req.query.days as string) || "10", 10) || 10, 90);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayShamsi = getShamsiPartsServer(today);

  const patients = await db
    .select()
    .from(patientsTable)
    .where(isNotNull(patientsTable.birthdate));

  const results: {
    patientId: number;
    name: string;
    phone: string;
    birthdate: string;
    birthdayShamsiYear: number;
    birthdayShamsiMonth: number;
    birthdayShamsiDay: number;
    daysUntil: number;
  }[] = [];

  for (const patient of patients) {
    if (!patient.birthdate) continue;
    const parts = patient.birthdate.split("-").map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) continue;
    let birthMonth: number, birthDay: number;
    if (parts[0] > 1700) {
      // Stored as Gregorian — convert to Shamsi month/day for the birthday match
      const g = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
      const sh = getShamsiPartsServer(g);
      birthMonth = sh.month;
      birthDay = sh.day;
    } else {
      // Legacy value already stored as Shamsi
      birthMonth = parts[1];
      birthDay = parts[2];
    }

    // Try this year first, then next year
    for (const yearOffset of [0, 1]) {
      const birthdayYear = todayShamsi.year + yearOffset;
      const birthdayGreg = shamsiToGregorianServer(birthdayYear, birthMonth, birthDay);

      // Verify conversion was accurate (handles invalid dates like Esfand 30 in non-leap)
      const check = getShamsiPartsServer(birthdayGreg);
      if (check.month !== birthMonth || check.day !== birthDay) continue;

      birthdayGreg.setHours(0, 0, 0, 0);
      const diffDays = Math.round(
        (birthdayGreg.getTime() - today.getTime()) / 86400000,
      );

      if (diffDays < 0) continue; // already passed this year, try next
      if (diffDays <= daysAhead) {
        results.push({
          patientId: patient.id,
          name: patient.name,
          phone: patient.phone,
          birthdate: patient.birthdate,
          birthdayShamsiYear: birthdayYear,
          birthdayShamsiMonth: birthMonth,
          birthdayShamsiDay: birthDay,
          daysUntil: diffDays,
        });
      }
      break; // either included or too far ahead — done with this patient
    }
  }

  results.sort((a, b) => a.daysUntil - b.daysUntil);
  res.json(results);
});

router.get("/patients/export/excel", async (_req, res): Promise<void> => {
  const patients = await db.select().from(patientsTable).orderBy(desc(patientsTable.createdAt));
  // Simple CSV export since xlsx is heavy - client can import to Excel
  const headers = ["شناسه", "شماره پرونده", "نام", "موبایل", "ایمیل", "تاریخ تولد", "جنسیت"];
  const rows = patients.map(p => [p.id, p.fileNumber, p.name, p.phone, p.email ?? "", p.birthdate ?? "", p.gender ?? ""]);
  const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=patients.csv");
  res.send("\uFEFF" + csv);
});

router.get("/patients/:id", async (req, res): Promise<void> => {
  const params = GetPatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, params.data.id));
  if (!patient) {
    res.status(404).json({ error: "بیمار یافت نشد" });
    return;
  }
  const [enriched] = await enrichReferrerNames([patient]);
  res.json(enriched);
});

router.put("/patients/:id", async (req, res): Promise<void> => {
  const params = UpdatePatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePatientBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [patient] = await db.update(patientsTable).set(parsed.data).where(eq(patientsTable.id, params.data.id)).returning();
  if (!patient) {
    res.status(404).json({ error: "بیمار یافت نشد" });
    return;
  }
  await logActivity("update", "patient", patient.id, `اطلاعات بیمار "${patient.name}" ویرایش شد`);
  res.json(patient);
});

router.delete("/patients/:id", requireAdmin, async (req, res): Promise<void> => {
  const params = DeletePatientParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const patientId = params.data.id;
  const existing = await db.select().from(patientsTable).where(eq(patientsTable.id, patientId)).get();
  if (!existing) {
    res.status(404).json({ error: "بیمار یافت نشد" });
    return;
  }
  await db.transaction(async (tx) => {
    const appts = await tx.select({ id: appointmentsTable.id }).from(appointmentsTable).where(eq(appointmentsTable.patientId, patientId));
    const apptIds = appts.map((a) => a.id);
    let paymentIds: number[] = [];
    if (apptIds.length > 0) {
      const payments = await tx.select({ id: paymentsTable.id }).from(paymentsTable).where(inArray(paymentsTable.appointmentId, apptIds));
      paymentIds = payments.map((p) => p.id);
    }
    // کمیسیون‌های مرتبط با نوبت‌ها/پرداخت‌های این مراجع و کمیسیون‌هایی که این مراجع دریافت‌کننده‌شان بوده
    const commissionConditions = [
      and(eq(commissionsTable.recipientType, "patient"), eq(commissionsTable.recipientId, patientId)),
    ];
    if (apptIds.length > 0) commissionConditions.push(inArray(commissionsTable.appointmentId, apptIds));
    if (paymentIds.length > 0) commissionConditions.push(inArray(commissionsTable.paymentId, paymentIds));
    await tx.delete(commissionsTable).where(or(...commissionConditions));
    if (paymentIds.length > 0) {
      await tx.delete(paymentsTable).where(inArray(paymentsTable.id, paymentIds));
    }
    await tx.delete(appointmentsTable).where(eq(appointmentsTable.patientId, patientId));
    await tx.delete(patientNotesTable).where(eq(patientNotesTable.patientId, patientId));
    await tx.delete(patientAccountTransactionsTable).where(eq(patientAccountTransactionsTable.patientId, patientId));
    await tx.delete(remindersTable).where(eq(remindersTable.patientId, patientId));
    await tx.delete(patientsTable).where(eq(patientsTable.id, patientId));
  });
  await logActivity("delete", "patient", existing.id, `بیمار "${existing.name}" حذف شد`);
  res.sendStatus(204);
});

router.get("/patients/:id/appointments", async (req, res): Promise<void> => {
  const params = ListPatientAppointmentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select({
      id: appointmentsTable.id,
      patientId: appointmentsTable.patientId,
      serviceId: appointmentsTable.serviceId,
      staffId: appointmentsTable.staffId,
      scheduledAt: appointmentsTable.scheduledAt,
      status: appointmentsTable.status,
      notes: appointmentsTable.notes,
      price: appointmentsTable.price,
      discountId: appointmentsTable.discountId,
      originalPrice: appointmentsTable.originalPrice,
      createdAt: appointmentsTable.createdAt,
      patientName: patientsTable.name,
      patientPhone: patientsTable.phone,
      patientFileNumber: patientsTable.fileNumber,
      serviceName: servicesTable.name,
      servicePrice: sql<number>`CASE WHEN ${servicesTable.priceMode} = 'per_unit' THEN ${servicesTable.price} * coalesce(${servicesTable.unitCount}, 1) ELSE ${servicesTable.price} END`,
      staffName: staffTable.name,
    })
    .from(appointmentsTable)
    .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .leftJoin(servicesTable, eq(appointmentsTable.serviceId, servicesTable.id))
    .leftJoin(staffTable, eq(appointmentsTable.staffId, staffTable.id))
    .where(eq(appointmentsTable.patientId, params.data.id))
    .orderBy(desc(appointmentsTable.scheduledAt));
  res.json({ data: rows, total: rows.length });
});

// ── Account balance (شارژ اکانت) ─────────────────────────────────────────────

router.get("/patients/:id/account-transactions", async (req, res): Promise<void> => {
  const params = ListPatientAccountTransactionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(patientAccountTransactionsTable)
    .where(eq(patientAccountTransactionsTable.patientId, params.data.id))
    .orderBy(desc(patientAccountTransactionsTable.createdAt));
  res.json(rows);
});

router.post("/patients/:id/account-transactions", async (req, res): Promise<void> => {
  const params = CreatePatientAccountTransactionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreatePatientAccountTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, params.data.id));
  if (!patient) {
    res.status(404).json({ error: "بیمار یافت نشد" });
    return;
  }

  // مقدار همیشه به‌صورت قدر مطلق گرفته می‌شود؛ علامت را نوع تراکنش تعیین می‌کند
  const magnitude = Math.abs(Math.round(parsed.data.amount));
  const isDeduct = parsed.data.type === "deduct";
  const signed = isDeduct ? -magnitude : magnitude;

  if (isDeduct && magnitude > patient.accountBalance) {
    res.status(400).json({ error: "موجودی اکانت کافی نیست" });
    return;
  }

  const newBalance = patient.accountBalance + signed;
  const [tx] = await db.insert(patientAccountTransactionsTable).values({
    patientId: patient.id,
    amount: signed,
    type: parsed.data.type,
    description: parsed.data.description ?? null,
    paymentId: parsed.data.paymentId ?? null,
  }).returning();
  await db.update(patientsTable).set({ accountBalance: newBalance }).where(eq(patientsTable.id, patient.id));

  const label = isDeduct ? "برداشت از" : "شارژ";
  await logActivity("update", "patient", patient.id, `${label} اکانت بیمار "${patient.name}" به مبلغ ${magnitude.toLocaleString()} تومان`);
  res.status(201).json(tx);
});

export default router;
