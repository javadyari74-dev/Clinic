import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, loyaltyTransactionsTable, loyaltyMembersTable, patientsTable } from "@workspace/db";
import {
  UpdateLoyaltySettingsBody,
  GetPatientLoyaltyParams,
  AdjustLoyaltyPointsBody,
} from "@workspace/api-zod";
import {
  LOYALTY_SETTING_KEYS,
  LOYALTY_ERRORS,
  LOYALTY_TIERS,
  getLoyaltySettings,
  getLoyaltyBalance,
  getSpend12m,
  getExpiringSoon,
  nextTierInfo,
  backfillLoyaltyMembers,
  recomputeAllTiers,
  adjustLoyaltyPoints,
  isLoyaltyTier,
} from "../lib/loyalty";
import { setAppSetting } from "../lib/sms";
import { logActivity } from "../lib/activity";
import { requireAdmin } from "../lib/auth";

const router: IRouter = Router();

// ── باشگاه مشتریان ────────────────────────────────────────────────────────────
// تنظیمات (نرخ کسب/ارزش امتیاز/حداقل استفاده، سطح‌ها، انقضا، هدیه‌ها)، نمای کلی،
// فهرست اعضا، تنظیم دستی امتیاز و وضعیت هر مراجع. خودِ کسب/خرج امتیاز و عضویت
// خودکار داخل مسیر پرداخت‌ها (اتمیک) انجام می‌شود.

const nowSec = () => Math.floor(Date.now() / 1000);

router.get("/loyalty/settings", async (_req, res): Promise<void> => {
  res.json(await getLoyaltySettings());
});

router.put("/loyalty/settings", async (req, res): Promise<void> => {
  const parsed = UpdateLoyaltySettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;
  const before = await getLoyaltySettings();
  await setAppSetting(LOYALTY_SETTING_KEYS.enabled, b.enabled ? "true" : "false");
  await setAppSetting(LOYALTY_SETTING_KEYS.earnAmount, String(Math.round(b.earnAmount)));
  await setAppSetting(LOYALTY_SETTING_KEYS.redeemValue, String(Math.round(b.redeemValue)));
  await setAppSetting(LOYALTY_SETTING_KEYS.minRedeem, String(Math.round(b.minRedeem)));
  const optional = [
    ["silverMin", b.silverMin],
    ["goldMin", b.goldMin],
    ["diamondMin", b.diamondMin],
    ["silverRate", b.silverRate],
    ["goldRate", b.goldRate],
    ["diamondRate", b.diamondRate],
    ["expiryMonths", b.expiryMonths],
    ["birthdayBonus", b.birthdayBonus],
    ["referralBonus", b.referralBonus],
  ] as const;
  for (const [key, value] of optional) {
    if (value !== undefined) await setAppSetting(LOYALTY_SETTING_KEYS[key], String(Math.max(0, Math.round(value))));
  }
  const settings = await getLoyaltySettings();
  // با روشن شدن باشگاه، همهٔ مراجعینِ دارای پرداخت (بدون پیامک) عضو می‌شوند؛
  // با تغییر مرز سطح‌ها، سطح همه دوباره حساب می‌شود
  if (settings.enabled) {
    await backfillLoyaltyMembers(nowSec());
    const tiersChanged = ["silverMin", "goldMin", "diamondMin"].some(
      (k) => before[k as keyof typeof before] !== settings[k as keyof typeof settings],
    );
    if (tiersChanged || !before.enabled) await recomputeAllTiers(nowSec(), settings);
  }
  await logActivity("update", "loyalty", 0, `تنظیمات باشگاه مشتریان به‌روزرسانی شد (${settings.enabled ? "فعال" : "غیرفعال"})`);
  res.json(settings);
});

router.get("/loyalty/overview", async (_req, res): Promise<void> => {
  const settings = await getLoyaltySettings();
  const [totals] = await db
    .select({
      totalEarned: sql<number>`COALESCE(SUM(CASE WHEN ${loyaltyTransactionsTable.type} IN ('earn', 'birthday', 'referral') THEN ${loyaltyTransactionsTable.delta} ELSE 0 END), 0)`,
      totalRedeemed: sql<number>`COALESCE(SUM(CASE WHEN ${loyaltyTransactionsTable.type} = 'redeem' THEN -${loyaltyTransactionsTable.delta} ELSE 0 END), 0)`,
      totalExpired: sql<number>`COALESCE(SUM(CASE WHEN ${loyaltyTransactionsTable.type} = 'expire' THEN -${loyaltyTransactionsTable.delta} ELSE 0 END), 0)`,
      totalOutstanding: sql<number>`COALESCE(SUM(${loyaltyTransactionsTable.delta}), 0)`,
    })
    .from(loyaltyTransactionsTable);

  const tierRows = await db
    .select({ tier: loyaltyMembersTable.tier, count: sql<number>`COUNT(*)` })
    .from(loyaltyMembersTable)
    .groupBy(loyaltyMembersTable.tier);
  const membersByTier = Object.fromEntries(LOYALTY_TIERS.map((t) => [t, 0])) as Record<string, number>;
  for (const r of tierRows) membersByTier[r.tier] = Number(r.count);
  const totalMembers = Object.values(membersByTier).reduce((a, b) => a + b, 0);

  const expiring = await getExpiringSoon(nowSec(), settings, 30);

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
    .limit(30);

  res.json({
    totalMembers,
    membersByTier,
    totalEarned: Number(totals?.totalEarned ?? 0),
    totalRedeemed: Number(totals?.totalRedeemed ?? 0),
    totalExpired: Number(totals?.totalExpired ?? 0),
    totalOutstanding: Number(totals?.totalOutstanding ?? 0),
    expiringSoonPoints: expiring.reduce((s, e) => s + e.points, 0),
    expiringSoonMembers: expiring.length,
    recent,
  });
});

// فهرست اعضا با سطح، موجودی، خرید ۱۲ ماه و تاریخ عضویت
router.get("/loyalty/members", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      patientId: loyaltyMembersTable.patientId,
      tier: loyaltyMembersTable.tier,
      joinedAt: loyaltyMembersTable.joinedAt,
      patientName: patientsTable.name,
      fileNumber: patientsTable.fileNumber,
      phone: patientsTable.phone,
      balance: sql<number>`COALESCE((SELECT SUM(delta) FROM loyalty_transactions t WHERE t.patient_id = ${loyaltyMembersTable.patientId}), 0)`,
    })
    .from(loyaltyMembersTable)
    .innerJoin(patientsTable, eq(patientsTable.id, loyaltyMembersTable.patientId))
    .orderBy(desc(loyaltyMembersTable.joinedAt));
  const spend = await getSpend12m(db, nowSec());
  res.json(rows.map((r) => ({ ...r, balance: Number(r.balance), spend12m: spend.get(r.patientId) ?? 0 })));
});

// افزودن/کسر دستی امتیاز — فقط مدیر
router.post("/loyalty/adjust", requireAdmin, async (req, res): Promise<void> => {
  const parsed = AdjustLoyaltyPointsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { patientId, points, description } = parsed.data;
  if (!Number.isInteger(points) || points === 0) {
    res.status(400).json({ error: "تعداد امتیاز باید عددی صحیح و غیر صفر باشد" });
    return;
  }
  const member = await db.select().from(loyaltyMembersTable).where(eq(loyaltyMembersTable.patientId, patientId)).get();
  if (!member) {
    res.status(404).json({ error: "این مراجع عضو باشگاه نیست" });
    return;
  }
  try {
    const balance = await adjustLoyaltyPoints(patientId, points, (description ?? "").trim());
    await logActivity("update", "loyalty", patientId, `${points > 0 ? "افزودن" : "کسر"} دستی ${Math.abs(points)} امتیاز`);
    res.json({ balance });
  } catch (err) {
    if (err instanceof Error && err.message === LOYALTY_ERRORS.insufficient) {
      res.status(400).json({ error: "امتیاز مراجع برای این کسر کافی نیست" });
      return;
    }
    throw err;
  }
});

router.get("/patients/:id/loyalty", async (req, res): Promise<void> => {
  const params = GetPatientLoyaltyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const id = params.data.id;
  const [patient] = await db.select({ id: patientsTable.id }).from(patientsTable).where(eq(patientsTable.id, id));
  if (!patient) {
    res.status(404).json({ error: "مراجع یافت نشد" });
    return;
  }
  const [settings, balance, transactions, member, spendMap] = await Promise.all([
    getLoyaltySettings(),
    getLoyaltyBalance(db, id),
    db
      .select()
      .from(loyaltyTransactionsTable)
      .where(eq(loyaltyTransactionsTable.patientId, id))
      .orderBy(desc(loyaltyTransactionsTable.id))
      .limit(50),
    db.select().from(loyaltyMembersTable).where(eq(loyaltyMembersTable.patientId, id)).get(),
    getSpend12m(db, nowSec(), id),
  ]);
  const spend12m = spendMap.get(id) ?? 0;
  res.json({
    balance,
    settings,
    transactions,
    member: member
      ? {
          tier: isLoyaltyTier(member.tier) ? member.tier : "bronze",
          joinedAt: member.joinedAt,
          spend12m,
          nextTier: nextTierInfo(spend12m, settings),
        }
      : null,
  });
});

export default router;
