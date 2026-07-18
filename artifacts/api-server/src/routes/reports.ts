import { Router, type IRouter } from "express";
import { sql, lt } from "drizzle-orm";
import { db, paymentsTable, appointmentsTable, patientsTable, commissionsTable, inventoryTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/reports/summary", async (_req, res): Promise<void> => {
  const [{ total: totalRevenue }] = await db
    .select({ total: sql<number>`coalesce(sum(amount), 0)` })
    .from(paymentsTable);

  const [{ total: totalAppointments }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(appointmentsTable);

  const [{ total: totalPatients }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(patientsTable);

  const [{ total: totalPaidCommissions }] = await db
    .select({ total: sql<number>`coalesce(sum(amount), 0)` })
    .from(commissionsTable)
    .where(sql`is_paid = true`);

  const [{ total: totalUnpaidCommissions }] = await db
    .select({ total: sql<number>`coalesce(sum(amount), 0)` })
    .from(commissionsTable)
    .where(sql`is_paid = false`);

  const statusRows = await db
    .select({
      status: appointmentsTable.status,
      count: sql<number>`count(*)`,
    })
    .from(appointmentsTable)
    .groupBy(appointmentsTable.status);

  const lowStockItems = await db
    .select()
    .from(inventoryTable)
    .where(sql`${inventoryTable.quantity} <= ${inventoryTable.minQuantity}`);

  res.json({
    totalRevenue: Number(totalRevenue),
    totalAppointments: Number(totalAppointments),
    totalPatients: Number(totalPatients),
    totalPaidCommissions: Number(totalPaidCommissions),
    totalUnpaidCommissions: Number(totalUnpaidCommissions),
    appointmentsByStatus: statusRows.map(r => ({ status: r.status, count: Number(r.count) })),
    lowStockItems,
  });
});

export default router;
