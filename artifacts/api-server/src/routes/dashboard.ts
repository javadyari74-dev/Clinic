import { Router, type IRouter } from "express";
import { eq, sql, gte, lt, and } from "drizzle-orm";
import { db, appointmentsTable, patientsTable, paymentsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const now = Math.floor(Date.now() / 1000);
  const startOfDay = now - (now % 86400);
  const endOfDay = startOfDay + 86400;

  // Start of this month (UTC)
  const d = new Date();
  const startOfMonth = Math.floor(new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000);
  const startOfNextMonth = Math.floor(new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() / 1000);

  const [{ total: totalPatients }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(patientsTable);

  const [{ total: appointmentsToday }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(appointmentsTable)
    .where(and(gte(appointmentsTable.scheduledAt, startOfDay), lt(appointmentsTable.scheduledAt, endOfDay)));

  const [{ total: pendingAppointments }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(appointmentsTable)
    .where(sql`${appointmentsTable.status} IN ('scheduled', 'confirmed', 'arrived', 'in_progress')`);

  const [{ total: completedThisMonth }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(appointmentsTable)
    .where(and(
      eq(appointmentsTable.status, "completed"),
      gte(appointmentsTable.scheduledAt, startOfMonth),
      lt(appointmentsTable.scheduledAt, startOfNextMonth)
    ));

  const [{ total: cancelledThisMonth }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(appointmentsTable)
    .where(and(
      eq(appointmentsTable.status, "cancelled"),
      gte(appointmentsTable.scheduledAt, startOfMonth),
      lt(appointmentsTable.scheduledAt, startOfNextMonth)
    ));

  const [{ total: monthlyRevenue }] = await db
    .select({ total: sql<number>`coalesce(sum(amount), 0)` })
    .from(paymentsTable)
    .where(and(
      gte(paymentsTable.paidAt, startOfMonth),
      lt(paymentsTable.paidAt, startOfNextMonth)
    ));

  res.json({
    totalPatients: Number(totalPatients),
    appointmentsToday: Number(appointmentsToday),
    monthlyRevenue: Number(monthlyRevenue),
    pendingAppointments: Number(pendingAppointments),
    completedThisMonth: Number(completedThisMonth),
    cancelledThisMonth: Number(cancelledThisMonth),
  });
});

router.get("/dashboard/revenue-chart", async (_req, res): Promise<void> => {
  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAgo = now - 30 * 86400;

  const rows = await db
    .select({
      day: sql<number>`floor(${paymentsTable.paidAt} / 86400) * 86400`,
      revenue: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)`,
    })
    .from(paymentsTable)
    .where(gte(paymentsTable.paidAt, thirtyDaysAgo))
    .groupBy(sql`floor(${paymentsTable.paidAt} / 86400) * 86400`)
    .orderBy(sql`floor(${paymentsTable.paidAt} / 86400) * 86400`);

  const chart = rows.map(r => ({
    date: new Date(Number(r.day) * 1000).toISOString().split("T")[0],
    revenue: Number(r.revenue),
  }));

  res.json(chart);
});

export default router;
