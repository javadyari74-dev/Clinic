import { Router, type IRouter } from "express";
import { eq, sql, gte, lt, and, desc } from "drizzle-orm";
import { db, paymentsTable, commissionsTable, servicesTable, expensesTable, laserPaymentsTable } from "@workspace/db";
import { DEPOSIT_NOTE } from "../lib/payment-effects";
import { tehranTodayBounds, shamsiMonthBounds, shamsiYearBounds } from "../lib/tehran-period";
import { appointmentCostSql, costPartSql, unitsSql, PRICE_VERSION_JOIN, SERVICE_DATE } from "../lib/service-cost";

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
// هزینه با «نسخهٔ قیمتِ» معتبر در روز ارائهٔ خدمت (lib/service-cost.ts)، نه قیمت امروز خدمت.
const UNITS = unitsSql();
const APPT_COST = appointmentCostSql();
const FIRST_PAID = sql`(SELECT min(p.paid_at) FROM payments p
  WHERE p.appointment_id = a.id AND coalesce(p.notes, '') <> 'بیعانه')`;

/** نوبت‌های ارائه‌شده‌ای که هزینه‌شان در [start, end) شمرده می‌شود، با هزینه و واحد مصرفی */
function servedAppointmentsSql(start: number, end: number) {
  return sql`
    SELECT a.id AS appointment_id, a.service_id AS service_id, first_paid,
           cost, units, doctor_cost, material_cost, other_cost
    FROM (
      SELECT a.id, a.service_id, ${FIRST_PAID} AS first_paid, ${APPT_COST} AS cost, ${UNITS} AS units,
        ${costPartSql("doctor")} AS doctor_cost, ${costPartSql("material")} AS material_cost, ${costPartSql("other")} AS other_cost
      FROM appointments a
      INNER JOIN services s ON s.id = a.service_id
      ${PRICE_VERSION_JOIN}
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

// GET /api/accounting/profit-details?from&to — ریز سود هر خدمت و هر نوبت با همان قواعد by-service:
//   درآمد نوبت = پرداخت‌های نقدی همان نوبت در بازه؛ هزینه (پزشک/مواد/سایر) با نسخهٔ قیمت روز خدمت و فقط
//   در بازهٔ اولین پرداخت غیربیعانه؛ پورسانت = پورسانت‌های همان نوبت در بازه. سود = درآمد − هزینه − پورسانت.
//   برای هر خدمت، «دوره‌ها» بر اساس نسخهٔ قیمت (تاریخ تغییر هزینه) تا تغییر سود در طول زمان دیده شود.
router.get("/accounting/profit-details", async (req, res): Promise<void> => {
  const range = resolveRange(req.query);
  if ("error" in range) { res.status(400).json({ error: range.error }); return; }
  const { start, end } = range;

  const rows = await db.all<{
    appointment_id: number; service_id: number; service_name: string; category: string | null;
    patient_id: number | null; patient_name: string | null; service_date: number; version_from: number | null;
    revenue: number; served: number; doctor: number; material: number; other: number; commission: number;
  }>(sql`
    SELECT a.id AS appointment_id, a.service_id AS service_id, s.name AS service_name, s.category AS category,
      pt.id AS patient_id, pt.name AS patient_name, ${SERVICE_DATE} AS service_date,
      v.effective_from AS version_from,
      coalesce(pay.revenue, 0) AS revenue,
      (sv.appointment_id IS NOT NULL) AS served,
      coalesce(sv.doctor_cost, 0) AS doctor, coalesce(sv.material_cost, 0) AS material, coalesce(sv.other_cost, 0) AS other,
      coalesce(cm.amount, 0) AS commission
    FROM appointments a
    INNER JOIN services s ON s.id = a.service_id
    LEFT JOIN patients pt ON pt.id = a.patient_id
    ${PRICE_VERSION_JOIN}
    LEFT JOIN (
      SELECT appointment_id, sum(amount) AS revenue FROM payments
      WHERE paid_at >= ${start} AND paid_at < ${end} AND appointment_id IS NOT NULL GROUP BY appointment_id
    ) pay ON pay.appointment_id = a.id
    LEFT JOIN (${servedAppointmentsSql(start, end)}) sv ON sv.appointment_id = a.id
    LEFT JOIN (
      SELECT appointment_id, sum(amount) AS amount FROM commissions
      WHERE created_at >= ${start} AND created_at < ${end} AND appointment_id IS NOT NULL GROUP BY appointment_id
    ) cm ON cm.appointment_id = a.id
    WHERE pay.appointment_id IS NOT NULL OR sv.appointment_id IS NOT NULL OR cm.appointment_id IS NOT NULL
    ORDER BY service_date ASC, a.id ASC
  `);

  type Visit = {
    appointmentId: number; patientId: number | null; patientName: string | null; serviceDate: number;
    versionFrom: number; counted: boolean; revenue: number; doctorCost: number; materialCost: number;
    otherCost: number; serviceCost: number; commission: number; profit: number;
  };
  const byService = new Map<number, { serviceId: number; serviceName: string; category: string | null; visits: Visit[] }>();
  for (const r of rows) {
    const doctor = Number(r.doctor), material = Number(r.material), other = Number(r.other);
    const revenue = Number(r.revenue), commission = Number(r.commission);
    const serviceCost = doctor + material + other;
    const visit: Visit = {
      appointmentId: Number(r.appointment_id),
      patientId: r.patient_id == null ? null : Number(r.patient_id),
      patientName: r.patient_name,
      serviceDate: Number(r.service_date),
      versionFrom: Number(r.version_from ?? 0),
      counted: Boolean(Number(r.served)),
      revenue, doctorCost: doctor, materialCost: material, otherCost: other, serviceCost, commission,
      profit: revenue - serviceCost - commission,
    };
    const key = Number(r.service_id);
    const g = byService.get(key) ?? { serviceId: key, serviceName: r.service_name, category: r.category, visits: [] };
    g.visits.push(visit);
    byService.set(key, g);
  }

  const sum = (vs: Visit[], k: keyof Visit) => vs.reduce((t, v) => t + Number(v[k]), 0);
  const services = [...byService.values()].map((g) => {
    // دوره‌ها: نوبت‌هایی که هزینه‌شان در این بازه شمرده شده، به تفکیک نسخهٔ قیمت (قدیمی → جدید)
    const periodMap = new Map<number, Visit[]>();
    for (const v of g.visits) if (v.counted) periodMap.set(v.versionFrom, [...(periodMap.get(v.versionFrom) ?? []), v]);
    const periods = [...periodMap.entries()].sort((a, b) => a[0] - b[0]).map(([versionFrom, vs]) => {
      const n = vs.length;
      return {
        versionFrom,
        firstDate: Math.min(...vs.map((v) => v.serviceDate)),
        lastDate: Math.max(...vs.map((v) => v.serviceDate)),
        count: n,
        avgRevenue: Math.round(sum(vs, "revenue") / n),
        avgDoctorCost: Math.round(sum(vs, "doctorCost") / n),
        avgMaterialCost: Math.round(sum(vs, "materialCost") / n),
        avgOtherCost: Math.round(sum(vs, "otherCost") / n),
        avgServiceCost: Math.round(sum(vs, "serviceCost") / n),
        avgProfit: Math.round(sum(vs, "profit") / n),
      };
    });
    const revenue = sum(g.visits, "revenue");
    const profit = sum(g.visits, "profit");
    return {
      serviceId: g.serviceId,
      serviceName: g.serviceName,
      category: g.category,
      count: g.visits.filter((v) => v.counted).length,
      revenue,
      doctorCost: sum(g.visits, "doctorCost"),
      materialCost: sum(g.visits, "materialCost"),
      otherCost: sum(g.visits, "otherCost"),
      serviceCost: sum(g.visits, "serviceCost"),
      commission: sum(g.visits, "commission"),
      profit,
      profitMargin: revenue > 0 ? Math.round((profit / revenue) * 100) : 0,
      periods,
      visits: g.visits,
    };
  }).sort((a, b) => b.profit - a.profit);

  res.json({ from: start, to: end, services });
});

// GET /api/accounting/debts — بدهی‌ها و طلب‌های «همین الان» (مستقل از بازهٔ گزارش و خارج از سود و زیان):
//   suppliers = خریدهای تسویه‌نشده (بدهی مطب به فروشنده‌ها؛ خرید وارد سود و زیان نمی‌شود)
//   patients  = مانده‌ی نوبت‌های تسویه‌شده با بدهی (طلب مطب از مراجعین؛ همان «remaining» نوبت‌ها)
router.get("/accounting/debts", async (_req, res): Promise<void> => {
  const bySupplier = await db.all<{ supplier: string | null; total: number; count: number }>(sql`
    SELECT nullif(trim(supplier), '') AS supplier, coalesce(sum(price), 0) AS total, count(*) AS count
    FROM purchases WHERE is_settled = 0
    GROUP BY nullif(trim(supplier), '') ORDER BY total DESC
  `);
  const [patients] = await db.all<{ total: number; count: number; patientCount: number }>(sql`
    SELECT coalesce(sum(rem), 0) AS total, count(*) AS count, count(DISTINCT patient_id) AS patientCount FROM (
      SELECT a.patient_id, a.price - (
        SELECT coalesce(sum(p.amount + coalesce(p.wallet_amount, 0) + coalesce(p.points_amount, 0)), 0)
        FROM payments p WHERE p.appointment_id = a.id
      ) AS rem
      FROM appointments a
      WHERE a.price IS NOT NULL AND a.status <> 'cancelled'
        AND EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = a.id AND coalesce(p.notes, '') <> ${DEPOSIT_NOTE})
    ) WHERE rem > 0
  `);
  const supplierRows = bySupplier.map((r) => ({ supplier: r.supplier, total: Number(r.total), count: Number(r.count) }));
  res.json({
    suppliers: {
      total: supplierRows.reduce((s, r) => s + r.total, 0),
      count: supplierRows.reduce((s, r) => s + r.count, 0),
      bySupplier: supplierRows,
    },
    patients: {
      total: Number(patients?.total ?? 0),
      count: Number(patients?.count ?? 0),
      patientCount: Number(patients?.patientCount ?? 0),
    },
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
  const servedRows = await db.all<{ service_id: number; served: number; units: number; cost: number; doctor: number; material: number; other: number }>(sql`
    SELECT service_id, count(*) AS served, coalesce(sum(units), 0) AS units, coalesce(sum(cost), 0) AS cost,
           coalesce(sum(doctor_cost), 0) AS doctor, coalesce(sum(material_cost), 0) AS material, coalesce(sum(other_cost), 0) AS other
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
    const unitCount = svc.unitCount ?? 1;
    // جمع هر جزء هزینه با قیمتِ روز ارائهٔ هر نوبت (نسخهٔ معتبر در تاریخچهٔ قیمت)
    const doctorFeeTotal = Number(served?.doctor ?? 0);
    const materialCostTotal = Number(served?.material ?? 0);
    const otherCostTotal = Number(served?.other ?? 0);
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
