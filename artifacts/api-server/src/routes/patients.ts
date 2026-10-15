import { Router, type IRouter } from "express";
import { eq, or, and, like, desc, count, isNotNull, sql, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { patientsTable, appointmentsTable, servicesTable, staffTable, commissionRecipientsTable, patientAccountTransactionsTable, paymentsTable, patientNotesTable, remindersTable, commissionsTable, loyaltyMembersTable, loyaltyTransactionsTable, waitingListTable, surveysTable } from "@workspace/db";
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
import { fireCommissionSms } from "../lib/sms";
import { getUpcomingBirthdays } from "../lib/birthdays";
import { appointmentWithDetails } from "../lib/appointment-details";
import { PaymentEffectError, PAYMENT_EFFECT_MESSAGES, hasPaidCommissions, reversePaymentEffects } from "../lib/payment-effects";

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
  // موجودی کیف پول فقط از راه تراکنش‌های حساب تغییر می‌کند (تا با سابقه همخوان بماند)
  const { accountBalance: _ignoredBalance, ...values } = parsed.data;
  const [patient] = await db.insert(patientsTable).values(values).returning();
  await logActivity("create", "patient", patient.id, `بیمار جدید "${patient.name}" ثبت شد`);
  res.status(201).json(patient);
});

// GET /api/patients/upcoming-birthdays?days=10
router.get("/patients/upcoming-birthdays", async (req, res): Promise<void> => {
  const daysAhead = Math.min(parseInt((req.query.days as string) || "10", 10) || 10, 90);
  const results = await getUpcomingBirthdays(daysAhead);
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
  // موجودی کیف پول از ویرایش مراجع تغییر نمی‌کند؛ فقط از راه تراکنش‌های حساب
  const { accountBalance: _ignoredBalance, ...changes } = parsed.data;
  const [patient] = Object.keys(changes).length > 0
    ? await db.update(patientsTable).set(changes).where(eq(patientsTable.id, params.data.id)).returning()
    : await db.select().from(patientsTable).where(eq(patientsTable.id, params.data.id));
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
  // حذف مراجع: هر پرداختِ او به‌طور کامل برگردانده می‌شود (اعتبار معرفی/باشگاهی که به
  // مراجعین دیگر داده شده، کمیسیون‌ها، تخفیف‌ها) — اگر اعتبارِ مراجع دیگری قبلاً خرج شده
  // باشد یا پورسانتی تسویه شده باشد، حذف لغو می‌شود.
  try {
    await db.transaction(async (tx) => {
      const appts = await tx.select({ id: appointmentsTable.id }).from(appointmentsTable).where(eq(appointmentsTable.patientId, patientId));
      const apptIds = appts.map((a) => a.id);
      const payments = apptIds.length > 0
        ? await tx.select().from(paymentsTable).where(inArray(paymentsTable.appointmentId, apptIds)).orderBy(desc(paymentsTable.id))
        : [];
      const paymentIds = payments.map((p) => p.id);
      const ownCommission = and(eq(commissionsTable.recipientType, "patient"), eq(commissionsTable.recipientId, patientId));
      if (
        await hasPaidCommissions(tx, { paymentIds, appointmentIds: apptIds }) ||
        (await tx.select({ id: commissionsTable.id }).from(commissionsTable).where(and(ownCommission, eq(commissionsTable.isPaid, true))).limit(1)).length > 0
      ) {
        throw new PaymentEffectError("پورسانت مرتبط با این مراجع تسویه شده است؛ ابتدا تسویه را برگردانید");
      }
      // سوابق کیف پول و باشگاهِ خودِ مراجع پیش از برگرداندن پرداخت‌ها پاک می‌شود تا
      // برگرداندن فقط روی مراجعین دیگر (مثلاً معرف) اثر کند
      await tx.delete(patientAccountTransactionsTable).where(eq(patientAccountTransactionsTable.patientId, patientId));
      await tx.delete(loyaltyTransactionsTable).where(eq(loyaltyTransactionsTable.patientId, patientId));
      for (const payment of payments) {
        await tx.delete(paymentsTable).where(eq(paymentsTable.id, payment.id));
        await reversePaymentEffects(tx, payment, { ignoreWalletOf: patientId, skipCashbackReconcile: true, skipAppointmentRecompute: true });
      }
      // کمیسیون‌های باقی‌مانده‌ی نوبت‌های این مراجع و کمیسیون‌هایی که خودش دریافت‌کننده بوده
      const commissionConditions = [ownCommission];
      if (apptIds.length > 0) commissionConditions.push(inArray(commissionsTable.appointmentId, apptIds));
      await tx.delete(commissionsTable).where(or(...commissionConditions));
      // مراجعینی که این مراجع معرفشان بوده دیگر معرف ندارند
      await tx.update(patientsTable)
        .set({ referrerType: null, referrerId: null, referrerRate: null })
        .where(and(eq(patientsTable.referrerType, "patient"), eq(patientsTable.referrerId, patientId)));
      await tx.delete(appointmentsTable).where(eq(appointmentsTable.patientId, patientId));
      await tx.delete(patientNotesTable).where(eq(patientNotesTable.patientId, patientId));
      await tx.delete(loyaltyMembersTable).where(eq(loyaltyMembersTable.patientId, patientId));
      await tx.delete(remindersTable).where(eq(remindersTable.patientId, patientId));
      await tx.delete(waitingListTable).where(eq(waitingListTable.patientId, patientId));
      await tx.delete(surveysTable).where(eq(surveysTable.patientId, patientId));
      await tx.delete(patientsTable).where(eq(patientsTable.id, patientId));
    });
  } catch (err) {
    if (err instanceof PaymentEffectError) {
      const message = err.message === PAYMENT_EFFECT_MESSAGES.walletNegative
        ? "اعتباری که پرداخت‌های این مراجع به کیف پول مراجع دیگری (مثلاً معرف) داده قبلاً خرج شده است؛ حذف این مراجع ممکن نیست"
        : err.message;
      res.status(err.status).json({ error: message });
      return;
    }
    throw err;
  }
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
    .select(appointmentWithDetails)
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

  // نوع‌های ویژهٔ باشگاه و صندوق فقط از مسیرهای خودشان ثبت می‌شوند
  if (parsed.data.type.startsWith("loyalty_")) {
    res.status(400).json({ error: "این نوع تراکنش از این‌جا قابل ثبت نیست" });
    return;
  }
  // اعتبار معرفیِ دستی برای پرداختی که معرفش قبلاً اعتبار معرفی باشگاه یا اعتبار دستی گرفته، تکراری است
  if (parsed.data.type === "referral_credit" && parsed.data.paymentId) {
    const dup = await db.select({ id: patientAccountTransactionsTable.id }).from(patientAccountTransactionsTable)
      .where(and(
        eq(patientAccountTransactionsTable.patientId, params.data.id),
        eq(patientAccountTransactionsTable.paymentId, parsed.data.paymentId),
        inArray(patientAccountTransactionsTable.type, ["referral_credit", "loyalty_referral"]),
      )).get();
    if (dup) {
      res.status(400).json({ error: "این معرف برای همین پرداخت قبلاً اعتبار معرفی گرفته است" });
      return;
    }
  }

  // مقدار همیشه به‌صورت قدر مطلق گرفته می‌شود؛ علامت را نوع تراکنش تعیین می‌کند
  const magnitude = Math.abs(Math.round(parsed.data.amount));
  const isDeduct = parsed.data.type === "deduct";
  const signed = isDeduct ? -magnitude : magnitude;

  // بررسی موجودی و ثبت تراکنش اتمیک؛ موجودی نسبی به‌روز می‌شود تا با پرداخت هم‌زمان تداخل نکند
  const NOT_FOUND = "NOT_FOUND";
  const INSUFFICIENT = "INSUFFICIENT";
  let patient: typeof patientsTable.$inferSelect;
  let tx: typeof patientAccountTransactionsTable.$inferSelect;
  try {
    ({ patient, tx } = await db.transaction(async (t) => {
      const p = await t.select().from(patientsTable).where(eq(patientsTable.id, params.data.id)).get();
      if (!p) throw new Error(NOT_FOUND);
      if (isDeduct && magnitude > p.accountBalance) throw new Error(INSUFFICIENT);
      const [row] = await t.insert(patientAccountTransactionsTable).values({
        patientId: p.id,
        amount: signed,
        type: parsed.data.type,
        description: parsed.data.description ?? null,
        paymentId: parsed.data.paymentId ?? null,
      }).returning();
      await t.update(patientsTable)
        .set({ accountBalance: sql`${patientsTable.accountBalance} + ${signed}` })
        .where(eq(patientsTable.id, p.id));
      return { patient: p, tx: row };
    }));
  } catch (err) {
    if (err instanceof Error && err.message === NOT_FOUND) {
      res.status(404).json({ error: "بیمار یافت نشد" });
      return;
    }
    if (err instanceof Error && err.message === INSUFFICIENT) {
      res.status(400).json({ error: "موجودی اکانت کافی نیست" });
      return;
    }
    throw err;
  }

  const label = isDeduct ? "برداشت از" : "شارژ";
  await logActivity("update", "patient", patient.id, `${label} اکانت بیمار "${patient.name}" به مبلغ ${magnitude.toLocaleString()} تومان`);

  // اعتبار معرفی (معرف از نوع مراجع): پیامک اطلاع پورسانت برای بیمارِ معرف — آتش و فراموش
  if (parsed.data.type === "referral_credit") {
    // مبلغ پایه (پرداخت مرتبط) و درصد (وقتی دقیقاً قابل محاسبه است) تا پیامک «—» نشان ندهد
    const base = parsed.data.paymentId
      ? await db.select({ amount: paymentsTable.amount }).from(paymentsTable).where(eq(paymentsTable.id, parsed.data.paymentId)).get()
      : undefined;
    const baseAmount = base?.amount ?? null;
    const rate = baseAmount && baseAmount > 0 && Number.isInteger((magnitude * 100) / baseAmount) ? (magnitude * 100) / baseAmount : null;
    fireCommissionSms({
      referrerName: patient.name,
      phone: patient.phone,
      commissionAmount: magnitude,
      baseAmount,
      rate,
      referrerPatientId: patient.id,
    });
  }

  res.status(201).json(tx);
});

export default router;
