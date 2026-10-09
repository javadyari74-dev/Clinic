import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db, patientsTable, paymentsTable } from "@workspace/db";
import {
  TEHRAN_OFFSET_SEC, tehranTodayBounds, shamsiMonthBounds, tehranDayStart, scheduledAtMsSql,
} from "../lib/tehran-period";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  // «امروز» = روز تهران؛ «این ماه» = ماه شمسی جاری به وقت تهران (همان «این ماه» صفحهٔ حسابداری).
  // مرزها ثانیه‌اند؛ scheduled_at نوبت‌ها میلی‌ثانیه است و پرداخت‌ها ثانیه.
  const today = tehranTodayBounds();
  const month = shamsiMonthBounds();
  const at = scheduledAtMsSql("scheduled_at");

  const [{ total: totalPatients }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(patientsTable);

  const [counts] = await db.all<{ today: number; pending: number; completed: number; cancelled: number }>(sql`
    SELECT
      coalesce(sum(CASE WHEN ${at} >= ${today.start * 1000} AND ${at} < ${today.end * 1000} THEN 1 ELSE 0 END), 0) AS today,
      coalesce(sum(CASE WHEN status IN ('scheduled', 'confirmed', 'arrived', 'in_progress') THEN 1 ELSE 0 END), 0) AS pending,
      coalesce(sum(CASE WHEN status = 'completed' AND ${at} >= ${month.start * 1000} AND ${at} < ${month.end * 1000} THEN 1 ELSE 0 END), 0) AS completed,
      coalesce(sum(CASE WHEN status = 'cancelled' AND ${at} >= ${month.start * 1000} AND ${at} < ${month.end * 1000} THEN 1 ELSE 0 END), 0) AS cancelled
    FROM appointments
  `);

  // درآمد نقدی مطب (بدون لیزر)، همان عدد «درآمد کل» حسابداری برای «این ماه»
  const [{ total: monthlyRevenue }] = await db
    .select({ total: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)` })
    .from(paymentsTable)
    .where(sql`${paymentsTable.paidAt} >= ${month.start} AND ${paymentsTable.paidAt} < ${month.end}`);

  res.json({
    totalPatients: Number(totalPatients),
    appointmentsToday: Number(counts?.today ?? 0),
    monthlyRevenue: Number(monthlyRevenue),
    pendingAppointments: Number(counts?.pending ?? 0),
    completedThisMonth: Number(counts?.completed ?? 0),
    cancelledThisMonth: Number(counts?.cancelled ?? 0),
  });
});

// درآمد روزانهٔ ۳۰ روز اخیر (شامل امروز)؛ روزها به وقت تهران گروه می‌شوند، نه UTC.
// date = تاریخ میلادی روز تهران (YYYY-MM-DD).
router.get("/dashboard/revenue-chart", async (_req, res): Promise<void> => {
  const since = tehranDayStart(Math.floor(Date.now() / 1000)) - 29 * 86400;
  const day = sql<number>`cast((${paymentsTable.paidAt} + ${TEHRAN_OFFSET_SEC}) / 86400 as integer)`;

  const rows = await db
    .select({ day, revenue: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)` })
    .from(paymentsTable)
    .where(sql`${paymentsTable.paidAt} >= ${since}`)
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const chart = rows.map(r => ({
    date: new Date(Number(r.day) * 86400 * 1000).toISOString().slice(0, 10),
    revenue: Number(r.revenue),
  }));

  res.json(chart);
});

export default router;
