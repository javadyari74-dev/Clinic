import { Router, type IRouter } from "express";
import { eq, sql, gte, lt, and, desc } from "drizzle-orm";
import { db, paymentsTable, commissionsTable, servicesTable, appointmentsTable, expensesTable } from "@workspace/db";

const router: IRouter = Router();

function periodBounds(period: string): { start: number; end: number } {
  const now = new Date();
  if (period === "today") {
    const s = Math.floor(now.setHours(0, 0, 0, 0) / 1000);
    return { start: s, end: s + 86400 };
  }
  if (period === "month") {
    const s = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
    const e = Math.floor(new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() / 1000);
    return { start: s, end: e };
  }
  if (period === "year") {
    const s = Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);
    const e = Math.floor(new Date(now.getFullYear() + 1, 0, 1).getTime() / 1000);
    return { start: s, end: e };
  }
  return { start: 0, end: Math.floor(Date.now() / 1000) + 1 };
}

// GET /api/accounting/summary?period=today|month|year|all
router.get("/accounting/summary", async (req, res): Promise<void> => {
  const period = String(req.query.period ?? "month");
  const { start, end } = periodBounds(period);

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

  // هزینه خدمات: هر نوبت ارائه‌شده فقط یک‌بار شمرده می‌شود (نه به‌ازای هر ردیف پرداخت)،
  // تا بیعانه + پرداخت نهاییِ یک نوبت باعث شمارش دوباره هزینه نشود.
  // per_unit: هزینه خام × واحد مصرفیِ همان نوبت (coalesce(units_used, unit_count, 1))؛ total: هزینه خام ثابت.
  const [{ serviceCosts }] = await db
    .select({
      serviceCosts: sql<number>`coalesce(sum(
        (CASE WHEN s.doctor_fee_mode = 'per_unit' THEN s.doctor_fee * coalesce(a.units_used, s.unit_count, 1) ELSE s.doctor_fee END) +
        (CASE WHEN s.material_cost_mode = 'per_unit' THEN s.material_cost * coalesce(a.units_used, s.unit_count, 1) ELSE s.material_cost END) +
        (CASE WHEN s.other_cost_mode = 'per_unit' THEN s.other_cost * coalesce(a.units_used, s.unit_count, 1) ELSE s.other_cost END)
      ), 0)`,
    })
    .from(sql`appointments a`)
    .innerJoin(sql`services s`, sql`s.id = a.service_id`)
    .where(sql`EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = a.id AND p.paid_at >= ${start} AND p.paid_at < ${end} AND coalesce(p.notes, '') <> 'بیعانه')`);

  const totalExpenses = expenseRows.reduce((s, r) => s + Number(r.total), 0);
  const totalCommissions = Number(commissions);
  const totalRevenue = Number(revenue);
  const totalServiceCosts = Number(serviceCosts);
  const netProfit = totalRevenue - totalExpenses - totalCommissions - totalServiceCosts;

  const expensesByCategory: Record<string, number> = {};
  for (const r of expenseRows) {
    expensesByCategory[r.category] = Number(r.total);
  }

  res.json({
    revenue: totalRevenue,
    expenses: totalExpenses,
    commissions: totalCommissions,
    serviceCosts: totalServiceCosts,
    totalCosts: totalExpenses + totalCommissions + totalServiceCosts,
    netProfit,
    expensesByCategory,
  });
});

// GET /api/accounting/by-service?period=month|year|all
router.get("/accounting/by-service", async (req, res): Promise<void> => {
  const period = String(req.query.period ?? "month");
  const { start, end } = periodBounds(period);

  // همه خدمات (شامل غیرفعال‌هایی که در این بازه پرداخت داشته‌اند) تا تفکیک با هزینه خدمات کل (summary) همخوان بماند؛
  // فیلتر نهایی revenue/completedCount خدمات بدون فعالیت را حذف می‌کند.
  const services = await db.select().from(servicesTable);

  const results = await Promise.all(services.map(async (svc) => {
    const [{ revenue }] = await db
      .select({ revenue: sql<number>`coalesce(sum(p.amount), 0)` })
      .from(sql`payments p`)
      .innerJoin(sql`appointments a`, sql`a.id = p.appointment_id`)
      .where(sql`a.service_id = ${svc.id} AND p.paid_at >= ${start} AND p.paid_at < ${end}`);

    // نوبت‌های ارائه‌شده این خدمت: هر نوبت یک‌بار شمرده می‌شود (نه به‌ازای هر ردیف پرداخت).
    // فقط نوبت‌هایی که پرداخت غیربیعانه در این بازه دارند؛ sumUnits = مجموع واحد مصرفی این نوبت‌ها.
    const [{ servedCount, sumUnits }] = await db
      .select({
        servedCount: sql<number>`count(*)`,
        sumUnits: sql<number>`coalesce(sum(coalesce(a.units_used, ${svc.unitCount ?? 1}, 1)), 0)`,
      })
      .from(sql`appointments a`)
      .where(sql`a.service_id = ${svc.id} AND EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = a.id AND p.paid_at >= ${start} AND p.paid_at < ${end} AND coalesce(p.notes, '') <> 'بیعانه')`);

    const [{ commissionCost }] = await db
      .select({ commissionCost: sql<number>`coalesce(sum(c.amount), 0)` })
      .from(sql`commissions c`)
      .innerJoin(sql`appointments a`, sql`a.id = c.appointment_id`)
      .where(sql`a.service_id = ${svc.id} AND c.created_at >= ${start} AND c.created_at < ${end}`);

    const completedCount = Number(servedCount);
    const totalUnits = Number(sumUnits);
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
    const doctorFeeEff = perAppt(doctorFeeTotal, svc.doctorFee, svc.doctorFeeMode);
    const materialCostEff = perAppt(materialCostTotal, svc.materialCost, svc.materialCostMode);
    const otherCostEff = perAppt(otherCostTotal, svc.otherCost, svc.otherCostMode);
    const totalRevenue = Number(revenue);
    const totalCommission = Number(commissionCost);
    const profit = totalRevenue - totalServiceCost - totalCommission;

    return {
      serviceId: svc.id,
      serviceName: svc.name,
      category: svc.category,
      revenue: totalRevenue,
      doctorFeePerUnit: doctorFeeEff,
      materialCostPerUnit: materialCostEff,
      otherCostPerUnit: otherCostEff,
      doctorFeeTotal,
      materialCostTotal,
      otherCostTotal,
      totalServiceCost,
      commissions: totalCommission,
      completedCount,
      profit,
      profitMargin: totalRevenue > 0 ? Math.round((profit / totalRevenue) * 100) : 0,
    };
  }));

  res.json(results.filter(r => r.revenue > 0 || r.completedCount > 0).sort((a, b) => b.revenue - a.revenue));
});

// GET /api/accounting/chart?period=month|year
router.get("/accounting/chart", async (req, res): Promise<void> => {
  const period = String(req.query.period ?? "month");
  const days = period === "year" ? 365 : 30;
  const since = Math.floor(Date.now() / 1000) - days * 86400;

  const revenueRows = await db
    .select({
      day: sql<number>`floor(${paymentsTable.paidAt} / 86400) * 86400`,
      revenue: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)`,
    })
    .from(paymentsTable)
    .where(gte(paymentsTable.paidAt, since))
    .groupBy(sql`floor(${paymentsTable.paidAt} / 86400) * 86400`)
    .orderBy(sql`floor(${paymentsTable.paidAt} / 86400) * 86400`);

  const expenseRows = await db
    .select({
      day: sql<number>`floor(${expensesTable.date} / 86400) * 86400`,
      expenses: sql<number>`coalesce(sum(${expensesTable.amount}), 0)`,
    })
    .from(expensesTable)
    .where(gte(expensesTable.date, since))
    .groupBy(sql`floor(${expensesTable.date} / 86400) * 86400`)
    .orderBy(sql`floor(${expensesTable.date} / 86400) * 86400`);

  const revMap: Record<string, number> = {};
  for (const r of revenueRows) {
    const date = new Date(Number(r.day) * 1000).toISOString().split("T")[0];
    revMap[date] = Number(r.revenue);
  }
  const expMap: Record<string, number> = {};
  for (const r of expenseRows) {
    const date = new Date(Number(r.day) * 1000).toISOString().split("T")[0];
    expMap[date] = Number(r.expenses);
  }

  const allDates = Array.from(new Set([...Object.keys(revMap), ...Object.keys(expMap)])).sort();
  const chart = allDates.map(date => ({
    date,
    revenue: revMap[date] ?? 0,
    expenses: expMap[date] ?? 0,
    profit: (revMap[date] ?? 0) - (expMap[date] ?? 0),
  }));

  res.json(chart);
});

// GET /api/accounting/expenses
router.get("/accounting/expenses", async (req, res): Promise<void> => {
  const category = req.query.category ? String(req.query.category) : undefined;
  const limit = Number(req.query.limit ?? 50);
  const offset = Number(req.query.offset ?? 0);

  let query = db.select().from(expensesTable).orderBy(desc(expensesTable.date)).$dynamic();
  if (category) query = query.where(eq(expensesTable.category, category));
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
