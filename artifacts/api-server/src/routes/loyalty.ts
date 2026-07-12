import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, loyaltyTransactionsTable, patientsTable } from "@workspace/db";
import { UpdateLoyaltySettingsBody, GetPatientLoyaltyParams } from "@workspace/api-zod";
import {
  LOYALTY_SETTING_KEYS,
  getLoyaltySettings,
  getLoyaltyBalance,
} from "../lib/loyalty";
import { setAppSetting } from "../lib/sms";
import { logActivity } from "../lib/activity";

const router: IRouter = Router();

// ── باشگاه مشتریان ────────────────────────────────────────────────────────────
// تنظیمات (نرخ کسب/ارزش امتیاز/حداقل استفاده)، نمای کلی باشگاه و وضعیت امتیاز
// هر مراجع. خودِ کسب/خرج امتیاز داخل مسیر پرداخت‌ها (اتمیک) انجام می‌شود.

router.get("/loyalty/settings", async (_req, res): Promise<void> => {
  res.json(await getLoyaltySettings());
});

router.put("/loyalty/settings", async (req, res): Promise<void> => {
  const parsed = UpdateLoyaltySettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { enabled, earnAmount, redeemValue, minRedeem } = parsed.data;
  await setAppSetting(LOYALTY_SETTING_KEYS.enabled, enabled ? "true" : "false");
  await setAppSetting(LOYALTY_SETTING_KEYS.earnAmount, String(Math.round(earnAmount)));
  await setAppSetting(LOYALTY_SETTING_KEYS.redeemValue, String(Math.round(redeemValue)));
  await setAppSetting(LOYALTY_SETTING_KEYS.minRedeem, String(Math.round(minRedeem)));
  await logActivity("update", "loyalty", 0, `تنظیمات باشگاه مشتریان به‌روزرسانی شد (${enabled ? "فعال" : "غیرفعال"})`);
  res.json(await getLoyaltySettings());
});

router.get("/loyalty/overview", async (_req, res): Promise<void> => {
  // جمع‌های کلی
  const [totals] = await db
    .select({
      totalMembers: sql<number>`COUNT(DISTINCT ${loyaltyTransactionsTable.patientId})`,
      totalEarned: sql<number>`COALESCE(SUM(CASE WHEN ${loyaltyTransactionsTable.type} = 'earn' THEN ${loyaltyTransactionsTable.delta} ELSE 0 END), 0)`,
      totalRedeemed: sql<number>`COALESCE(SUM(CASE WHEN ${loyaltyTransactionsTable.type} = 'redeem' THEN -${loyaltyTransactionsTable.delta} ELSE 0 END), 0)`,
      totalOutstanding: sql<number>`COALESCE(SUM(${loyaltyTransactionsTable.delta}), 0)`,
    })
    .from(loyaltyTransactionsTable);

  // مراجعین برتر بر اساس موجودی فعلی امتیاز
  const topPatients = await db
    .select({
      patientId: loyaltyTransactionsTable.patientId,
      patientName: sql<string>`COALESCE(${patientsTable.name}, 'مراجع حذف‌شده')`,
      fileNumber: patientsTable.fileNumber,
      phone: patientsTable.phone,
      balance: sql<number>`COALESCE(SUM(${loyaltyTransactionsTable.delta}), 0)`,
      earnedTotal: sql<number>`COALESCE(SUM(CASE WHEN ${loyaltyTransactionsTable.type} = 'earn' THEN ${loyaltyTransactionsTable.delta} ELSE 0 END), 0)`,
    })
    .from(loyaltyTransactionsTable)
    .leftJoin(patientsTable, eq(loyaltyTransactionsTable.patientId, patientsTable.id))
    .groupBy(loyaltyTransactionsTable.patientId)
    .orderBy(desc(sql`COALESCE(SUM(${loyaltyTransactionsTable.delta}), 0)`))
    .limit(10);

  // آخرین تراکنش‌های امتیازی
  const recent = await db
    .select({
      id: loyaltyTransactionsTable.id,
      patientId: loyaltyTransactionsTable.patientId,
      paymentId: loyaltyTransactionsTable.paymentId,
      delta: loyaltyTransactionsTable.delta,
      amount: loyaltyTransactionsTable.amount,
      type: loyaltyTransactionsTable.type,
      description: loyaltyTransactionsTable.description,
      createdAt: loyaltyTransactionsTable.createdAt,
      patientName: patientsTable.name,
    })
    .from(loyaltyTransactionsTable)
    .leftJoin(patientsTable, eq(loyaltyTransactionsTable.patientId, patientsTable.id))
    .orderBy(desc(loyaltyTransactionsTable.id))
    .limit(20);

  res.json({
    totalMembers: totals?.totalMembers ?? 0,
    totalEarned: totals?.totalEarned ?? 0,
    totalRedeemed: totals?.totalRedeemed ?? 0,
    totalOutstanding: totals?.totalOutstanding ?? 0,
    topPatients,
    recent,
  });
});

router.get("/patients/:id/loyalty", async (req, res): Promise<void> => {
  const params = GetPatientLoyaltyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(eq(patientsTable.id, params.data.id));
  if (!patient) {
    res.status(404).json({ error: "مراجع یافت نشد" });
    return;
  }
  const [settings, balance, transactions] = await Promise.all([
    getLoyaltySettings(),
    getLoyaltyBalance(db, params.data.id),
    db
      .select()
      .from(loyaltyTransactionsTable)
      .where(eq(loyaltyTransactionsTable.patientId, params.data.id))
      .orderBy(desc(loyaltyTransactionsTable.id))
      .limit(50),
  ]);
  res.json({ balance, settings, transactions });
});

export default router;
