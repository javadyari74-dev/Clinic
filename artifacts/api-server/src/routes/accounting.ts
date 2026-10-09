import { Router, type IRouter } from "express";
import { eq, sql, gte, lt, and, desc } from "drizzle-orm";
import { db, paymentsTable, commissionsTable, servicesTable, expensesTable, laserPaymentsTable } from "@workspace/db";
import { tehranTodayBounds, shamsiMonthBounds, shamsiYearBounds } from "../lib/tehran-period";

const router: IRouter = Router();

// period قدیمی: روز/ماه/سال شمسی به وقت تهران (همان مرزهای presetRange صفحهٔ حسابداری)
function periodBounds(period: string): { start: number; end: number } {
  if (period === "today") return tehranTodayBounds();
  if (period === "month") return shamsiMonthBounds();
  if (period === "year") return shamsiYearBounds();
  return { start: 0, end: Math.floor(Date.now() / 1000) + 1 };
}

// بازهٔ گزارش: اگر from/to (ثانیه یونیکس، to انحصاری) داده شود همان استفاده می‌شود؛
// فرانت‌اند مرزهای روز/ماه/سال شمسی را در منطقهٔ زمانی کاربر حساب می‌کند و همین را می‌فرستد.
// در غیر این صورت برای سازگاری با نسخه‌های قدیمی، period پذیرفته می‌شود.
type RangeResult = { start: number; end: number } | { error: string };
function resolveRange(query: Record<string, unknown>): RangeResult {
  const hasFrom = query.from !== undefined && query.from !== "";
  const hasTo = query.to !== undefined && query.to !== "";
  if (!hasFrom && !hasTo) return periodBounds(String(query.period ?? "month"));
  const start = Number(query.from);
  const end = Number(query.to);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
    return { error: "بازهٔ زمانی نامعتبر است (from و to به ثانیه و from < to)" };
  }
  return { start, end };
}

// ── قاعدهٔ هزینهٔ خدمت (مشترک بین summary، by-service و chart) ──
// هزینهٔ خدمت هر نوبت فقط یک‌بار شمرده می‌شود: در بازه‌ای که «اولین پرداخت غیربیعانهٔ» آن نوبت
// (روی همهٔ پرداخت‌هایش، نه فقط پرداخت‌های داخل بازه) در آن است. پس پرداخت قسطی در چند ماه
// هزینه را چند بار کم نمی‌کند و جمع سود ماه‌ها با سود کل بازهٔ ترکیبی برابر است.
// فرمول هزینه همان appointmentServiceCost در lib/loyalty.ts است (ستون‌های خالی = صفر).
const UNITS = sql.raw(`coalesce(a.units_used, s.unit_count, 1)`);
const APPT_COST = sql`(
  (CASE WHEN s.doctor_fee_mode = 'per_unit' THEN coalesce(s.doctor_fee, 0) * ${UNITS} ELSE coalesce(s.doctor_fee, 0) END) +
  (CASE WHEN s.material_cost_mode = 'per_unit' THEN coalesce(s.material_cost, 0) * ${UNITS} ELSE coalesce(s.material_cost, 0) END) +
  (CASE WHEN s.other_cost_mode = 'per_unit' THEN coalesce(s.other_cost, 0) * ${UNITS} ELSE coalesce(s.other_cost, 0) END)
)`;
const FIRST_PAID = sql`(SELECT min(p.paid_at) FROM payments p
  WHERE p.appointment_id = a.id AND coalesce(p.notes, '') <> 'بیعانه')`;

/** نوبت‌های ارائه‌شده‌ای که هزینه‌شان در [start, end) شمرده می‌شود، با هزینه و واحد مصرفی */
function servedAppointmentsSql(start: number, end: number) {
  return sql`
    SELECT a.id AS appointment_id, a.service_id AS service_id, first_paid,
           cost, units
    FROM (
      SELECT a.id, a.service_id, ${FIRST_PAID} AS first_paid, ${APPT_COST} AS cost, ${UNITS} AS units
      FROM appointments a
      INNER JOIN services s ON s.id = a.service_id
    ) a
    WHERE first_paid >= ${start} AND first_paid < ${end}
  `;
}

async function laserTotals(start: number, end: number) {
  const [row] = await db
    .select({
      revenue: sql<number>`coalesce(sum(${laserPaymentsTable.amount}), 0)`,
      commissions: sql<number>`coalesce(sum(${laserPaymentsTable.commissionAmount}), 0)`,
    })
    .from(laserPaymentsTable)
    .where(sql`${laserPaymentsTable.paidAt} >= ${start} AND ${laserPaymentsTable.paidAt} < ${end}`);
  return { revenue: Number(row?.revenue ?? 0), commissions: Number(row?.commissions ?? 0) };
}

// GET /api/accounting/summary?period=today|month|year|all
// revenue = درآمد نقدی مطب؛ لیزر جدا (laserRevenue / laserCommissions) ولی در سود خالص لحاظ می‌شود:
//   سود خالص = درآمد + درآمد لیزر − هزینه خدمات − هزینه‌های ثابت − پورسانت − پورسانت لیزر
router.get("/accounting/summary", async (req, res): Promise<void> => {
  const range = resolveRange(req.query);
  if ("error" in range) { res.status(400).json({ error: range.error }); return; }
  const { start, end } = range;

  const [{ revenue }] = await db
    .select({ revenue: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)` })
    .from(paymentsTable)
    .where(and(gte(paymentsTable.paidAt, start), lt(paymentsTable.paidAt, end)));

  const [{ commissions }] = await db
    .select({ commissions: sql<number>`coalesce(sum(${commissionsTable.amount}), 0)` })
    .from(commissionsTable)
    .where(and(gte(commissionsTable.createdAt, start), lt(commissionsTable.createdAt, end)));

  const expenseRows = await db
    .select({
      category: expensesTable.category,
      total: sql<number>`coalesce(sum(${expensesTable.amount}), 0)`,
    })
    .from(expensesTable)
    .where(and(gte(expensesTable.date, start), lt(expensesTable.date, end)))
    .groupBy(expensesTable.category);

  const [{ serviceCosts }] = await db.all<{ serviceCosts: number }>(sql`
    SELECT coalesce(sum(cost), 0) AS serviceCosts FROM (${servedAppointmentsSql(start, end)})
  `);

  const laser = await laserTotals(start, end);

  const totalExpenses = expenseRows.reduce((s, r) => s + Number(r.total), 0);
  const totalCommissions = Number(commissions);
  const totalRevenue = Number(revenue);
  const totalServiceCosts = Number(serviceCosts);
  const totalCosts = totalExpenses + totalCommissions + totalServiceCosts + laser.commissions;
  const netProfit = totalRevenue + laser.revenue - totalCosts;

  const expensesByCategory: Record<string, number> = {};
  for (const r of expenseRows) {
    expensesByCategory[r.category] = Number(r.total);
  }

  res.json({
    revenue: totalRevenue,
    laserRevenue: laser.revenue,
    expenses: totalExpenses,
    commissions: totalCommissions,
    laserCommissions: laser.commissions,
    serviceCosts: totalServiceCosts,
    totalCosts,
    netProfit,
    expensesByCategory,
  });
});

// شناسهٔ ردیف‌های ساختگی تفکیک خدمات (پرداخت/پورسانتی که به خدمتی نمی‌رسد)
const NO_APPOINTMENT_ROW_ID = -1;
const NO_SERVICE_ROW_ID = -2;

// GET /api/accounting/by-service?period=month|year|all
// جمع ستون‌ها (درآمد، هزینه خدمات، پورسانت) دقیقاً با /summary (بدون لیزر) برابر است:
// پرداخت‌های نوبت‌های حذف‌شده در ردیف «بدون نوبت / حذف‌شده» و پورسانت‌های بدون نوبت در «بدون خدمت».
router.get("/accounting/by-service", async (req, res): Promise<void> => {
  const range = resolveRange(req.query);
  if ("error" in range) { res.status(400).json({ error: range.error }); return; }
  const { start, end } = range;

  // همه خدمات (شامل غیرفعال‌هایی که در این بازه پرداخت داشته‌اند) تا تفکیک با هزینه خدمات کل (summary) همخوان بماند؛
  // فیلتر نهایی revenue/completedCount خدمات بدون فعالیت را حذف می‌کند.
  const services = await db.select().from(servicesTable);

  // درآمد هر خدمت؛ service_id = NULL یعنی نوبت یا خدمتش وجود ندارد
  const revenueRows = await db.all<{ service_id: number | null; has_appt: number; revenue: number }>(sql`
    SELECT s.id AS service_id, (a.id IS NOT NULL) AS has_appt, coalesce(sum(p.amount), 0) AS revenue
    FROM payments p
    LEFT JOIN appointments a ON a.id = p.appointment_id
    LEFT JOIN services s ON s.id = a.service_id
    WHERE p.paid_at >= ${start} AND p.paid_at < ${end}
    GROUP BY 1, 2
  `);

  // نوبت‌های ارائه‌شده هر خدمت (هر نوبت یک‌بار، در بازهٔ اولین پرداخت غیربیعانه‌اش)
  const servedRows = await db.all<{ service_id: number; served: number; units: number; cost: number }>(sql`
    SELECT service_id, count(*) AS served, coalesce(sum(units), 0) AS units, coalesce(sum(cost), 0) AS cost
    FROM (${servedAppointmentsSql(start, end)})
    GROUP BY service_id
  `);

  const commissionRows = await db.all<{ service_id: number | null; has_appt_ref: number; has_appt: number; amount: number }>(sql`
    SELECT s.id AS service_id, (c.appointment_id IS NOT NULL) AS has_appt_ref, (a.id IS NOT NULL) AS has_appt,
           coalesce(sum(c.amount), 0) AS amount
    FROM commissions c
    LEFT JOIN appointments a ON a.id = c.appointment_id
    LEFT JOIN services s ON s.id = a.service_id
    WHERE c.created_at >= ${start} AND c.created_at < ${end}
    GROUP BY 1, 2, 3
  `);

  const revenueBy = new Map<number, number>();
  let orphanRevenue = 0;      // پرداخت نوبت حذف‌شده
  let noServiceRevenue = 0;   // نوبت هست ولی خدمتش حذف شده
  for (const r of revenueRows) {
    if (r.service_id != null) revenueBy.set(Number(r.service_id), Number(r.revenue));
    else if (Number(r.has_appt)) noServiceRevenue += Number(r.revenue);
    else orphanRevenue += Number(r.revenue);
  }
  const commissionBy = new Map<number, number>();
  let orphanCommission = 0;     // پورسانتِ نوبت حذف‌شده
  let noServiceCommission = 0;  // پورسانت بدون نوبت، یا نوبتی که خدمتش حذف شده
  for (const r of commissionRows) {
    if (r.service_id != null) commissionBy.set(Number(r.service_id), Number(r.amount));
    else if (Number(r.has_appt_ref) && !Number(r.has_appt)) orphanCommission += Number(r.amount);
    else noServiceCommission += Number(r.amount);
  }
  const servedBy = new Map(servedRows.map(r => [Number(r.service_id), r]));

  const results = services.map((svc) => {
    const served = servedBy.get(svc.id);
    const completedCount = Number(served?.served ?? 0);
    const totalUnits = Number(served?.units ?? 0);
    const unitCount = svc.unitCount ?? 1;
    // per_unit: هزینه خام × مجموع واحد مصرفی همه نوبت‌ها؛ total: هزینه خام × تعداد نوبت
    const costTotal = (val: number | null | undefined, mode: string | null | undefined) =>
      mode === "per_unit" ? (val ?? 0) * totalUnits : (val ?? 0) * completedCount;
    const doctorFeeTotal = costTotal(svc.doctorFee, svc.doctorFeeMode);
    const materialCostTotal = costTotal(svc.materialCost, svc.materialCostMode);
    const otherCostTotal = costTotal(svc.otherCost, svc.otherCostMode);
    const totalServiceCost = doctorFeeTotal + materialCostTotal + otherCostTotal;
    // میانگین هزینه به‌ازای هر نوبت (برای نمایش)؛ اگر نوبتی نبود، حالت پیش‌فرض واحد سرویس
    const perAppt = (total: number, val: number | null | undefined, mode: string | null | undefined) =>
      completedCount > 0 ? Math.round(total / completedCount) : (mode === "per_unit" ? (val ?? 0) * unitCount : (val ?? 0));
    const totalRevenue = revenueBy.get(svc.id) ?? 0;
    const totalCommission = commissionBy.get(svc.id) ?? 0;
    const profit = totalRevenue - totalServiceCost - totalCommission;

    return {
      serviceId: svc.id,
      serviceName: svc.name,
      category: svc.category,
      revenue: totalRevenue,
      doctorFeePerUnit: perAppt(doctorFeeTotal, svc.doctorFee, svc.doctorFeeMode),
      materialCostPerUnit: perAppt(materialCostTotal, svc.materialCost, svc.materialCostMode),
      otherCostPerUnit: perAppt(otherCostTotal, svc.otherCost, svc.otherCostMode),
      doctorFeeTotal,
      materialCostTotal,
      otherCostTotal,
      totalServiceCost,
      commissions: totalCommission,
      completedCount,
      profit,
      profitMargin: totalRevenue > 0 ? Math.round((profit / totalRevenue) * 100) : 0,
    };
  });

  const syntheticRow = (serviceId: number, serviceName: string, revenue: number, commissions: number) => {
    const profit = revenue - commissions;
    return {
      serviceId, serviceName, category: null,
      revenue,
      doctorFeePerUnit: 0, materialCostPerUnit: 0, otherCostPerUnit: 0,
      doctorFeeTotal: 0, materialCostTotal: 0, otherCostTotal: 0, totalServiceCost: 0,
      commissions,
      completedCount: 0,
      profit,
      profitMargin: revenue > 0 ? Math.round((profit / revenue) * 100) : 0,
    };
  };
  const extra = [];
  if (orphanRevenue !== 0 || orphanCommission !== 0) {
    extra.push(syntheticRow(NO_APPOINTMENT_ROW_ID, "بدون نوبت / حذف‌شده", orphanRevenue, orphanCommission));
  }
  if (noServiceRevenue !== 0 || noServiceCommission !== 0) {
    extra.push(syntheticRow(NO_SERVICE_ROW_ID, "بدون خدمت", noServiceRevenue, noServiceCommission));
  }

  res.json([
    ...results
      .filter(r => r.revenue > 0 || r.completedCount > 0 || r.commissions > 0)
      .sort((a, b) => b.revenue - a.revenue),
    ...extra,
  ]);
});

// GET /api/accounting/revenue-range?from=<unix>&to=<unix>
router.get("/accounting/revenue-range", async (req, res): Promise<void> => {
  const from = Number(req.query.from);
  const to = Number(req.query.to);
  if (!from || !to || isNaN(from) || isNaN(to)) {
    res.status(400).json({ error: "from and to (unix seconds) are required" });
    return;
  }
  const [{ revenue }] = await db
    .select({ revenue: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)` })
    .from(paymentsTable)
    .where(and(gte(paymentsTable.paidAt, from), lt(paymentsTable.paidAt, to)));
  res.json({ revenue: Number(revenue), from, to });
});

// GET /api/accounting/chart?from=<unix>&to=<unix>&tz=<minutes east of UTC>
// ارقام روزانهٔ بازه، با همان تعاریف /summary تا جمع روزها دقیقاً با کارت‌های خلاصه یکی باشد:
//   سود = درآمد + درآمد لیزر − هزینه خدمات − هزینه‌های ثابت − پورسانت − پورسانت لیزر
// مرز روزها با منطقهٔ زمانی کاربر (tz) حساب می‌شود، نه UTC؛ وگرنه پرداخت‌های بامداد و
// هزینه‌هایی که با «نیمه‌شب محلی» ثبت شده‌اند در روز قبل نمایش داده می‌شوند.
// روزهای بدون داده برگردانده نمی‌شوند؛ فرانت‌اند خالی‌ها را پر و در صورت نیاز ماهانه (شمسی) گروه می‌کند.
// برای سازگاری، period=month|year (۳۰/۳۶۵ روز گذشته) هم پذیرفته می‌شود.
router.get("/accounting/chart", async (req, res): Promise<void> => {
  let start: number;
  let end: number;
  if (req.query.from === undefined && req.query.to === undefined) {
    const days = String(req.query.period ?? "month") === "year" ? 365 : 30;
    end = Math.floor(Date.now() / 1000) + 1;
    start = end - days * 86400;
  } else {
    const range = resolveRange(req.query);
    if ("error" in range) { res.status(400).json({ error: range.error }); return; }
    ({ start, end } = range);
  }
  const tzMinutes = req.query.tz === undefined ? 0 : Number(req.query.tz);
  if (!Number.isInteger(tzMinutes) || Math.abs(tzMinutes) > 14 * 60) {
    res.status(400).json({ error: "منطقهٔ زمانی نامعتبر است" });
    return;
  }
  const tz = tzMinutes * 60;
  const dayOf = (col: unknown) => sql<number>`cast((${col} + ${tz}) / 86400 as integer)`;

  const [revenueRows, expenseRows, commissionRows, serviceCostRows, laserRows] = await Promise.all([
    db
      .select({ day: dayOf(paymentsTable.paidAt), amount: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)` })
      .from(paymentsTable)
      .where(and(gte(paymentsTable.paidAt, start), lt(paymentsTable.paidAt, end)))
      .groupBy(sql`1`),
    db
      .select({ day: dayOf(expensesTable.date), amount: sql<number>`coalesce(sum(${expensesTable.amount}), 0)` })
      .from(expensesTable)
      .where(and(gte(expensesTable.date, start), lt(expensesTable.date, end)))
      .groupBy(sql`1`),
    db
      .select({ day: dayOf(commissionsTable.createdAt), amount: sql<number>`coalesce(sum(${commissionsTable.amount}), 0)` })
      .from(commissionsTable)
      .where(and(gte(commissionsTable.createdAt, start), lt(commissionsTable.createdAt, end)))
      .groupBy(sql`1`),
    // هزینه خدمت هر نوبت یک‌بار، در روزِ اولین پرداخت غیربیعانهٔ آن نوبت (همان قاعدهٔ /summary)
    db.all<{ day: number; amount: number }>(sql`
      SELECT cast((first_paid + ${tz}) / 86400 as integer) AS day, coalesce(sum(cost), 0) AS amount
      FROM (${servedAppointmentsSql(start, end)})
      GROUP BY 1
    `),
    db
      .select({
        day: dayOf(laserPaymentsTable.paidAt),
        revenue: sql<number>`coalesce(sum(${laserPaymentsTable.amount}), 0)`,
        commissions: sql<number>`coalesce(sum(${laserPaymentsTable.commissionAmount}), 0)`,
      })
      .from(laserPaymentsTable)
      .where(sql`${laserPaymentsTable.paidAt} >= ${start} AND ${laserPaymentsTable.paidAt} < ${end}`)
      .groupBy(sql`1`),
  ]);

  type Point = {
    revenue: number; serviceCosts: number; expenses: number; commissions: number;
    laserRevenue: number; laserCommissions: number;
  };
  const days = new Map<number, Point>();
  const point = (day: number) => {
    let p = days.get(day);
    if (!p) {
      p = { revenue: 0, serviceCosts: 0, expenses: 0, commissions: 0, laserRevenue: 0, laserCommissions: 0 };
      days.set(day, p);
    }
    return p;
  };
  for (const r of revenueRows) point(Number(r.day)).revenue += Number(r.amount);
  for (const r of serviceCostRows) point(Number(r.day)).serviceCosts += Number(r.amount);
  for (const r of expenseRows) point(Number(r.day)).expenses += Number(r.amount);
  for (const r of commissionRows) point(Number(r.day)).commissions += Number(r.amount);
  for (const r of laserRows) {
    const p = point(Number(r.day));
    p.laserRevenue += Number(r.revenue);
    p.laserCommissions += Number(r.commissions);
  }

  const chart = [...days.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, p]) => {
      const totalCosts = p.serviceCosts + p.expenses + p.commissions + p.laserCommissions;
      return {
        // تاریخ میلادی روز محلی (YYYY-MM-DD)
        date: new Date(day * 86400 * 1000).toISOString().slice(0, 10),
        ...p,
        totalCosts,
        profit: p.revenue + p.laserRevenue - totalCosts,
      };
    });

  res.json(chart);
});

// GET /api/accounting/expenses
router.get("/accounting/expenses", async (req, res): Promise<void> => {
  const category = req.query.category ? String(req.query.category) : undefined;
  const limit = Number(req.query.limit ?? 50);
  const offset = Number(req.query.offset ?? 0);

  // from/to اختیاری: فقط هزینه‌های بازهٔ انتخاب‌شده در صفحهٔ حسابداری
  const conditions = [];
  if (category) conditions.push(eq(expensesTable.category, category));
  if (req.query.from !== undefined || req.query.to !== undefined) {
    const range = resolveRange(req.query);
    if ("error" in range) { res.status(400).json({ error: range.error }); return; }
    conditions.push(gte(expensesTable.date, range.start), lt(expensesTable.date, range.end));
  }
  let query = db.select().from(expensesTable).orderBy(desc(expensesTable.date)).$dynamic();
  if (conditions.length) query = query.where(and(...conditions));
  const rows = await query.limit(limit).offset(offset);
  res.json(rows);
});

// POST /api/accounting/expenses
router.post("/accounting/expenses", async (req, res): Promise<void> => {
  const { category, amount, description, date, serviceId, staffId } = req.body;
  if (!category || !amount || !description || !date) {
    res.status(400).json({ error: "category, amount, description, date are required" });
    return;
  }
  const [row] = await db.insert(expensesTable).values({
    category,
    amount: Number(amount),
    description,
    date: Number(date),
    serviceId: serviceId ? Number(serviceId) : undefined,
    staffId: staffId ? Number(staffId) : undefined,
  }).returning();
  res.status(201).json(row);
});

// PUT /api/accounting/expenses/:id
router.put("/accounting/expenses/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { category, amount, description, date } = req.body;
  const [row] = await db.update(expensesTable)
    .set({ category, amount: amount ? Number(amount) : undefined, description, date: date ? Number(date) : undefined })
    .where(eq(expensesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "not found" }); return; }
  res.json(row);
});

// DELETE /api/accounting/expenses/:id
router.delete("/accounting/expenses/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  await db.delete(expensesTable).where(eq(expensesTable.id, id));
  res.status(204).end();
});

export default router;
