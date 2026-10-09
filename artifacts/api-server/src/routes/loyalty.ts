import { Router, type IRouter } from "express";
import { eq, desc, sql, and, inArray } from "drizzle-orm";
import { db, loyaltyTransactionsTable, loyaltyMembersTable, patientsTable } from "@workspace/db";
import {
  UpdateLoyaltySettingsBody,
  GetPatientLoyaltyParams,
  AdjustLoyaltyPointsBody,
  RetroLoyaltyCashbackBody,
  NotifyLoyaltyMembersBody,
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
  getWalletBalance,
  retroProfitCashback,
  getMemberWalletInfo,
  TIER_LABELS,
} from "../lib/loyalty";
import { setAppSetting, sendSms, renderTemplate, formatToman, getSmsSettings } from "../lib/sms";
import { shamsiDateText } from "../lib/tehran-time";
import { tehranInstant } from "../lib/scheduled-sms";
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
    ["profitRewardPercent", b.profitRewardPercent],
    ["birthdayBonus", b.birthdayBonus],
    ["referralBonus", b.referralBonus],
  ] as const;
  for (const [key, value] of optional) {
    if (value === undefined) continue;
    // درصد پاداش سود می‌تواند اعشاری باشد (مثلاً ۲.۵)؛ بقیه عدد صحیح‌اند
    const stored = key === "profitRewardPercent" ? Math.min(100, Math.max(0, Math.round(value * 100) / 100)) : Math.max(0, Math.round(value));
    await setAppSetting(LOYALTY_SETTING_KEYS[key], String(stored));
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
      totalRewards: sql<number>`COALESCE(SUM(CASE WHEN ${loyaltyTransactionsTable.type} IN ('cashback', 'birthday', 'referral') AND ${loyaltyTransactionsTable.delta} = 0 THEN ${loyaltyTransactionsTable.amount} WHEN ${loyaltyTransactionsTable.type} = 'reverse' AND ${loyaltyTransactionsTable.delta} = 0 THEN -${loyaltyTransactionsTable.amount} ELSE 0 END), 0)`,
    })
    .from(loyaltyTransactionsTable);
  const [wallet] = await db
    .select({ total: sql<number>`COALESCE(SUM(${patientsTable.accountBalance}), 0)` })
    .from(loyaltyMembersTable)
    .innerJoin(patientsTable, eq(patientsTable.id, loyaltyMembersTable.patientId));

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
    totalRewards: Number(totals?.totalRewards ?? 0),
    walletTotal: Number(wallet?.total ?? 0),
    expiringSoonAmount: expiring.reduce((s, e) => s + e.points, 0),
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
      walletBalance: patientsTable.accountBalance,
      totalRewards: sql<number>`COALESCE((SELECT SUM(amount) FROM patient_account_transactions w WHERE w.patient_id = ${loyaltyMembersTable.patientId} AND w.type IN ('loyalty_cashback', 'loyalty_birthday', 'loyalty_referral')), 0)`,
    })
    .from(loyaltyMembersTable)
    .innerJoin(patientsTable, eq(patientsTable.id, loyaltyMembersTable.patientId))
    .orderBy(desc(loyaltyMembersTable.joinedAt));
  const spend = await getSpend12m(db, nowSec());
  res.json(rows.map((r) => ({
    ...r,
    balance: Number(r.balance),
    totalRewards: Number(r.totalRewards),
    spend12m: spend.get(r.patientId) ?? 0,
  })));
});

// افزودن/کسر دستی اعتبار کیف پول از صفحهٔ باشگاه — فقط مدیر
router.post("/loyalty/adjust", requireAdmin, async (req, res): Promise<void> => {
  const parsed = AdjustLoyaltyPointsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { patientId, amount, description } = parsed.data;
  if (!Number.isInteger(amount) || amount === 0) {
    res.status(400).json({ error: "مبلغ باید عددی صحیح و غیر صفر باشد" });
    return;
  }
  const member = await db.select().from(loyaltyMembersTable).where(eq(loyaltyMembersTable.patientId, patientId)).get();
  if (!member) {
    res.status(404).json({ error: "این مراجع عضو باشگاه نیست" });
    return;
  }
  try {
    const balance = await adjustLoyaltyPoints(patientId, amount, (description ?? "").trim());
    await logActivity("update", "loyalty", patientId, `${amount > 0 ? "افزودن" : "کسر"} دستی ${Math.abs(amount).toLocaleString()} تومان اعتبار کیف پول`);
    res.json({ balance });
  } catch (err) {
    if (err instanceof Error && err.message === LOYALTY_ERRORS.insufficient) {
      res.status(400).json({ error: "موجودی کیف پول مراجع برای این کسر کافی نیست" });
      return;
    }
    throw err;
  }
});

// تاریخ میلادی YYYY-MM-DD (روز تهران) → ابتدای آن روز به ثانیه؛ nextDay = ابتدای روز بعد
function dayStartSec(value: string | null | undefined, nextDay = false): number | null | "invalid" {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return "invalid";
  return Math.floor(tehranInstant(Number(m[1]), Number(m[2]), Number(m[3]) + (nextDay ? 1 : 0)) / 1000);
}

// اعتبار سودِ پرداخت‌های قبلی (پیش از فعال شدن اعتبار سود) — فقط مدیر.
// apply=false فقط پیش‌نمایش است؛ نوبت‌هایی که قبلاً اعتبار گرفته‌اند دوباره حساب نمی‌شوند.
router.post("/loyalty/retro-cashback", requireAdmin, async (req, res): Promise<void> => {
  const parsed = RetroLoyaltyCashbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const fromSec = dayStartSec(parsed.data.from);
  const toSec = dayStartSec(parsed.data.to, true);
  if (fromSec === "invalid" || toSec === "invalid" || (fromSec !== null && toSec !== null && fromSec >= toSec)) {
    res.status(400).json({ error: "بازهٔ تاریخ نامعتبر است" });
    return;
  }
  const settings = await getLoyaltySettings();
  if (!settings.enabled) {
    res.status(400).json({ error: "باشگاه مشتریان غیرفعال است" });
    return;
  }
  const apply = parsed.data.apply;
  if (apply) await backfillLoyaltyMembers(nowSec());
  const result = await retroProfitCashback({ fromSec, toSec, apply });

  let smsSent = 0;
  let smsFailed = 0;
  const smsText = (parsed.data.smsText ?? "").trim();
  if (apply && result.total > 0) {
    await logActivity("update", "loyalty", null,
      `اعتبار سود پرداخت‌های قبلی: ${result.total.toLocaleString()} تومان برای ${result.patients.length} مراجع`);
    if (smsText) {
      for (const p of result.patients) {
        if (!p.phone) { smsFailed++; continue; }
        const text = renderTemplate(smsText, {
          "نام": p.name,
          "اعتبار": formatToman(p.amount),
          "امتیاز": formatToman(p.amount),
          "موجودی": formatToman(await getWalletBalance(db, p.patientId)),
        });
        const r = await sendSms({ to: p.phone, text, eventType: "loyalty_bulk", recipientName: p.name, patientId: p.patientId });
        if (r.ok) smsSent++; else smsFailed++;
      }
    }
  }
  res.json({
    appointments: result.appointments,
    total: result.total,
    smsSent,
    smsFailed,
    patients: result.patients.map(({ patientId, name, amount, appointments }) => ({ patientId, name, amount, appointments })),
  });
});

// پیام دستی باشگاه در هر لحظه: به یک یا چند عضو، یا همهٔ اعضا (با فیلتر سطح/موجودی/انقضا).
// متغیرها برای هر نفر جدا پر می‌شوند. dryRun فقط پیش‌نمایش می‌دهد.
router.post("/loyalty/notify", async (req, res): Promise<void> => {
  const parsed = NotifyLoyaltyMembersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { message, patientIds, tiers, onlyWithBalance, onlyExpiring, dryRun } = parsed.data;
  if (!message.trim()) {
    res.status(400).json({ error: "متن پیام خالی است" });
    return;
  }
  const settings = await getLoyaltySettings();
  const withinDays = Math.min(Math.max(Math.round(parsed.data.expiringWithinDays ?? 30), 1), 365);
  const conditions = [];
  if (patientIds && patientIds.length > 0) conditions.push(inArray(loyaltyMembersTable.patientId, patientIds));
  const tierList = (tiers ?? []).filter(isLoyaltyTier);
  if (tierList.length > 0) conditions.push(inArray(loyaltyMembersTable.tier, tierList));
  const members = await db
    .select({ patientId: loyaltyMembersTable.patientId, tier: loyaltyMembersTable.tier, name: patientsTable.name, phone: patientsTable.phone })
    .from(loyaltyMembersTable)
    .innerJoin(patientsTable, eq(patientsTable.id, loyaltyMembersTable.patientId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(patientsTable.name);

  const now = nowSec();
  const sms = await getSmsSettings();
  const usesPattern = sms.sendMode === "pattern" && sms.bodyIdLoyaltyNotify !== "";
  const recipients: Array<{ patientId: number; name: string; phone: string | null; text: string; balance: number; expiringAmount: number; expiresAt: number | null }> = [];
  for (const m of members) {
    const info = await getMemberWalletInfo(m.patientId, now, settings, withinDays);
    if (onlyWithBalance && info.balance <= 0) continue;
    if (onlyExpiring && info.expiringAmount <= 0) continue;
    const vars = {
      "نام": m.name,
      "موجودی": formatToman(info.balance),
      "اعتبار": formatToman(info.balance),
      "امتیاز": formatToman(info.balance),
      "سطح": isLoyaltyTier(m.tier) ? TIER_LABELS[m.tier] : "",
      "مبلغ_انقضا": formatToman(info.expiringAmount),
      "تاریخ_انقضا": info.expiresAt ? shamsiDateText(info.expiresAt * 1000) : "—",
    };
    recipients.push({
      patientId: m.patientId, name: m.name, phone: m.phone,
      text: renderTemplate(message, vars),
      balance: info.balance, expiringAmount: info.expiringAmount, expiresAt: info.expiresAt,
    });
  }

  let sent = 0;
  let failed = 0;
  if (!dryRun) {
    if (recipients.length === 0) {
      res.status(400).json({ error: "هیچ عضوی با این شرایط پیدا نشد" });
      return;
    }
    for (const r of recipients) {
      const result = await sendSms({
        to: r.phone ?? "",
        text: r.text,
        eventType: "loyalty_bulk",
        recipientName: r.name,
        patientId: r.patientId,
        // حالت خدماتی: {0}=نام {1}=موجودی {2}=مبلغ در حال انقضا {3}=تاریخ انقضا
        pattern: usesPattern
          ? {
              bodyId: sms.bodyIdLoyaltyNotify,
              args: [r.name, formatToman(r.balance), formatToman(r.expiringAmount), r.expiresAt ? shamsiDateText(r.expiresAt * 1000) : "—"],
            }
          : undefined,
      });
      if (result.ok) sent++; else failed++;
    }
    await logActivity("create", "sms", null, `پیام باشگاه به ${recipients.length.toLocaleString()} عضو: ${sent.toLocaleString()} ارسال، ${failed.toLocaleString()} ناموفق`);
  }
  res.json({ total: recipients.length, sent, failed, usesPattern, recipients });
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
  const [settings, balance, transactions, member, spendMap, walletBalance, rewards] = await Promise.all([
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
    getWalletBalance(db, id),
    db.all<{ total: number }>(sql`
      SELECT COALESCE(SUM(amount), 0) AS total FROM patient_account_transactions
      WHERE patient_id = ${id} AND type IN ('loyalty_cashback', 'loyalty_birthday', 'loyalty_referral')
    `),
  ]);
  const spend12m = spendMap.get(id) ?? 0;
  res.json({
    balance,
    walletBalance,
    totalRewards: Number(rewards[0]?.total ?? 0),
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
