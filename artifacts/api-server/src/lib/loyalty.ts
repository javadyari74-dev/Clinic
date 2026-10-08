import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  appSettingsTable,
  loyaltyTransactionsTable,
  loyaltyMembersTable,
  patientsTable,
  patientAccountTransactionsTable,
} from "@workspace/db";

// ── باشگاه مشتریان (امتیاز وفاداری) ─────────────────────────────────────────
// منطق کسب/خرج/برگردان امتیاز این‌جا متمرکز است تا ثبت پرداخت، حذف پرداخت و
// مسیرهای باشگاه همگی از یک منبع استفاده کنند.
//
// قواعد:
//   - کسب: به ازای هر «earnAmount» تومانِ پرداختی، ۱ امتیاز (گرد به پایین).
//   - خرج: هر امتیاز «redeemValue» تومان ارزش دارد؛ حداقل «minRedeem» امتیاز.
//   - موجودی = جمع deltaهای مراجع (ستون جداگانه نداریم تا ناهماهنگ نشود).
//   - همه‌ی درج‌ها داخل تراکنشِ همان پرداخت انجام می‌شوند (اتمیک).

export const LOYALTY_SETTING_KEYS = {
  enabled: "loyalty_enabled",
  earnAmount: "loyalty_earn_amount",
  redeemValue: "loyalty_redeem_value",
  minRedeem: "loyalty_min_redeem",
  // سطح‌بندی: حداقل مجموع پرداخت ۱۲ ماه اخیر (تومان) برای هر سطح
  silverMin: "loyalty_silver_min",
  goldMin: "loyalty_gold_min",
  diamondMin: "loyalty_diamond_min",
  // ضریب امتیاز هر سطح به درصد (۱۰۰ = عادی، ۱۵۰ = ۱.۵ برابر)
  silverRate: "loyalty_silver_rate",
  goldRate: "loyalty_gold_rate",
  diamondRate: "loyalty_diamond_rate",
  // انقضای امتیاز: چند ماه پس از کسب (۰ = بدون انقضا)
  expiryMonths: "loyalty_expiry_months",
  // پاداش اصلی باشگاه: درصدی از سود خدمت (مبلغ پرداخت − هزینهٔ خدمت) که به‌صورت
  // اعتبار تومانی به کیف پول مراجع شارژ می‌شود (ضریب سطح هم روی آن اعمال می‌شود)
  profitRewardPercent: "loyalty_profit_reward_percent",
  // اعتبار تومانیِ هدیهٔ تولد و معرفی دوست (۰ = خاموش) — به کیف پول
  birthdayBonus: "loyalty_birthday_credit",
  referralBonus: "loyalty_referral_credit",
} as const;

// اعداد شرح تراکنش‌ها با ارقام فارسی
const fa = (n: number) => n.toLocaleString("fa-IR");

export interface LoyaltySettings {
  enabled: boolean;
  /** به ازای هر این‌قدر تومان پرداخت، ۱ امتیاز */
  earnAmount: number;
  /** ارزش تومانی هر امتیاز هنگام استفاده */
  redeemValue: number;
  /** حداقل امتیاز لازم برای استفاده */
  minRedeem: number;
  silverMin: number;
  goldMin: number;
  diamondMin: number;
  silverRate: number;
  goldRate: number;
  diamondRate: number;
  expiryMonths: number;
  /** درصد سود خدمت که اعتبار کیف پول می‌شود (مثلاً ۵) */
  profitRewardPercent: number;
  /** اعتبار هدیهٔ تولد (تومان) */
  birthdayBonus: number;
  /** اعتبار معرفی دوست برای معرف (تومان) */
  referralBonus: number;
}

export const LOYALTY_DEFAULTS: LoyaltySettings = {
  enabled: false,
  earnAmount: 100_000,
  redeemValue: 10_000,
  minRedeem: 10,
  silverMin: 20_000_000,
  goldMin: 50_000_000,
  diamondMin: 100_000_000,
  silverRate: 120,
  goldRate: 150,
  diamondRate: 200,
  expiryMonths: 12,
  profitRewardPercent: 5,
  birthdayBonus: 100_000,
  referralBonus: 200_000,
};

function clampPercent(raw: string | null | undefined, fallback: number): number {
  const n = Number.parseFloat(String(raw ?? ""));
  if (!Number.isFinite(n) || n < 0 || n > 100) return fallback;
  return Math.round(n * 100) / 100;
}

function clampInt(raw: string | null | undefined, fallback: number, min: number): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < min) return fallback;
  return n;
}

export async function getLoyaltySettings(): Promise<LoyaltySettings> {
  const rows = await db
    .select()
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, Object.values(LOYALTY_SETTING_KEYS)));
  const map = new Map<string, string | null>();
  for (const r of rows) map.set(r.key, r.value);
  return {
    // باشگاه باید صریحاً روشن شود (پیش‌فرض خاموش)
    enabled: map.get(LOYALTY_SETTING_KEYS.enabled) === "true",
    earnAmount: clampInt(map.get(LOYALTY_SETTING_KEYS.earnAmount), LOYALTY_DEFAULTS.earnAmount, 1_000),
    redeemValue: clampInt(map.get(LOYALTY_SETTING_KEYS.redeemValue), LOYALTY_DEFAULTS.redeemValue, 1_000),
    minRedeem: clampInt(map.get(LOYALTY_SETTING_KEYS.minRedeem), LOYALTY_DEFAULTS.minRedeem, 1),
    silverMin: clampInt(map.get(LOYALTY_SETTING_KEYS.silverMin), LOYALTY_DEFAULTS.silverMin, 0),
    goldMin: clampInt(map.get(LOYALTY_SETTING_KEYS.goldMin), LOYALTY_DEFAULTS.goldMin, 0),
    diamondMin: clampInt(map.get(LOYALTY_SETTING_KEYS.diamondMin), LOYALTY_DEFAULTS.diamondMin, 0),
    silverRate: clampInt(map.get(LOYALTY_SETTING_KEYS.silverRate), LOYALTY_DEFAULTS.silverRate, 100),
    goldRate: clampInt(map.get(LOYALTY_SETTING_KEYS.goldRate), LOYALTY_DEFAULTS.goldRate, 100),
    diamondRate: clampInt(map.get(LOYALTY_SETTING_KEYS.diamondRate), LOYALTY_DEFAULTS.diamondRate, 100),
    expiryMonths: clampInt(map.get(LOYALTY_SETTING_KEYS.expiryMonths), LOYALTY_DEFAULTS.expiryMonths, 0),
    profitRewardPercent: clampPercent(map.get(LOYALTY_SETTING_KEYS.profitRewardPercent), LOYALTY_DEFAULTS.profitRewardPercent),
    birthdayBonus: clampInt(map.get(LOYALTY_SETTING_KEYS.birthdayBonus), LOYALTY_DEFAULTS.birthdayBonus, 0),
    referralBonus: clampInt(map.get(LOYALTY_SETTING_KEYS.referralBonus), LOYALTY_DEFAULTS.referralBonus, 0),
  };
}

// ── سطح‌بندی ────────────────────────────────────────────────────────────────

export const LOYALTY_TIERS = ["bronze", "silver", "gold", "diamond"] as const;
export type LoyaltyTier = (typeof LOYALTY_TIERS)[number];

export const TIER_LABELS: Record<LoyaltyTier, string> = {
  bronze: "برنزی",
  silver: "نقره‌ای",
  gold: "طلایی",
  diamond: "الماسی",
};

export function isLoyaltyTier(v: unknown): v is LoyaltyTier {
  return typeof v === "string" && (LOYALTY_TIERS as readonly string[]).includes(v);
}

export function tierRank(tier: string): number {
  const i = (LOYALTY_TIERS as readonly string[]).indexOf(tier);
  return i < 0 ? 0 : i;
}

/** سطح بر اساس مجموع پرداخت ۱۲ ماه اخیر */
export function tierForSpend(spend: number, s: Pick<LoyaltySettings, "silverMin" | "goldMin" | "diamondMin">): LoyaltyTier {
  if (s.diamondMin > 0 && spend >= s.diamondMin) return "diamond";
  if (s.goldMin > 0 && spend >= s.goldMin) return "gold";
  if (s.silverMin > 0 && spend >= s.silverMin) return "silver";
  return "bronze";
}

/** ضریب امتیاز سطح به درصد */
export function tierRate(tier: string, s: LoyaltySettings): number {
  if (tier === "diamond") return s.diamondRate;
  if (tier === "gold") return s.goldRate;
  if (tier === "silver") return s.silverRate;
  return 100;
}

/** سطح بعدی و مبلغ لازم برای رسیدن به آن (null برای الماسی) */
export function nextTierInfo(spend: number, s: LoyaltySettings): { tier: LoyaltyTier; min: number; remaining: number } | null {
  const steps: Array<[LoyaltyTier, number]> = [["silver", s.silverMin], ["gold", s.goldMin], ["diamond", s.diamondMin]];
  for (const [tier, min] of steps) {
    if (min > 0 && spend < min) return { tier, min, remaining: min - spend };
  }
  return null;
}

const YEAR_SEC = 365 * 86_400;

// مجموع پرداخت‌های ۱۲ ماه اخیر هر مراجع (پرداخت → نوبت → مراجع)
export async function getSpend12m(executor: LoyaltyExecutor, nowSec: number, patientId?: number): Promise<Map<number, number>> {
  const rows = await executor.all<{ patient_id: number; spend: number }>(sql`
    SELECT a.patient_id AS patient_id, COALESCE(SUM(p.amount), 0) AS spend
    FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id
    WHERE p.paid_at >= ${nowSec - YEAR_SEC} ${patientId != null ? sql`AND a.patient_id = ${patientId}` : sql``}
    GROUP BY a.patient_id
  `);
  return new Map(rows.map((r) => [Number(r.patient_id), Number(r.spend)]));
}

/** امتیاز کسب‌شده از یک پرداخت: گرد به پایینِ (مبلغ ÷ نرخ کسب) */
export function computeEarnPoints(amountPaid: number, earnAmount: number): number {
  if (!(amountPaid > 0) || !(earnAmount > 0)) return 0;
  return Math.floor(amountPaid / earnAmount);
}

// درایزل نوع تراکنش را جداگانه صادر نمی‌کند؛ هر دو حالت (db یا tx) را می‌پذیریم
export type LoyaltyExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function getLoyaltyBalance(executor: LoyaltyExecutor, patientId: number): Promise<number> {
  const [row] = await executor
    .select({ balance: sql<number>`COALESCE(SUM(${loyaltyTransactionsTable.delta}), 0)` })
    .from(loyaltyTransactionsTable)
    .where(eq(loyaltyTransactionsTable.patientId, patientId));
  return row?.balance ?? 0;
}

// کدهای خطا برای نگاشت به پیام فارسی در لایه‌ی مسیر
export const LOYALTY_ERRORS = {
  disabled: "LOYALTY_DISABLED",
  minRedeem: "LOYALTY_MIN_REDEEM",
  insufficient: "LOYALTY_INSUFFICIENT",
  negativeOnDelete: "LOYALTY_NEGATIVE_ON_DELETE",
} as const;

/**
 * اعمال آثار امتیازی یک پرداخت داخل تراکنشِ همان پرداخت:
 *   ۱) اگر redeemPoints > 0: اعتبارسنجی (فعال‌بودن، حداقل، کفایت موجودی) و درج ردیف خرج (منفی)
 *   ۲) اگر باشگاه فعال است: درج ردیف کسب بر اساس مبلغ نقدیِ همین پرداخت
 * خطاها با کدهای LOYALTY_* پرتاب می‌شوند تا کل تراکنش پرداخت برگردد.
 */
export async function applyLoyaltyOnPayment(
  tx: LoyaltyExecutor,
  args: {
    patientId: number;
    paymentId: number;
    amountPaid: number;
    redeemPoints: number;
    settings: LoyaltySettings;
    serviceName?: string | null;
    /** ضریب امتیاز سطح مراجع به درصد (پیش‌فرض ۱۰۰) */
    ratePercent?: number;
    /**
     * کسب امتیاز بر اساس مبلغ (حالت قدیمی). باشگاه اکنون به‌جای امتیاز، درصدی از سود
     * خدمت را اعتبار کیف پول می‌کند (applyProfitCashback)؛ مسیر پرداخت این را false می‌دهد.
     */
    earnPoints?: boolean;
  },
): Promise<{ earned: number; redeemed: number; redeemedValue: number }> {
  const { patientId, paymentId, amountPaid, settings, serviceName } = args;
  const redeemPoints = Math.max(0, Math.round(args.redeemPoints || 0));
  let redeemedValue = 0;

  if (redeemPoints > 0) {
    if (!settings.enabled) throw new Error(LOYALTY_ERRORS.disabled);
    if (redeemPoints < settings.minRedeem) throw new Error(LOYALTY_ERRORS.minRedeem);
    const balance = await getLoyaltyBalance(tx, patientId);
    if (redeemPoints > balance) throw new Error(LOYALTY_ERRORS.insufficient);
    redeemedValue = redeemPoints * settings.redeemValue;
    await tx.insert(loyaltyTransactionsTable).values({
      patientId,
      paymentId,
      delta: -redeemPoints,
      amount: redeemedValue,
      type: "redeem",
      description: `استفاده از ${fa(redeemPoints)} امتیاز (${fa(redeemedValue)} تومان)${serviceName ? ` — ${serviceName}` : ""}`,
    });
  }

  let earned = 0;
  if (settings.enabled && args.earnPoints !== false) {
    earned = Math.floor((computeEarnPoints(amountPaid, settings.earnAmount) * (args.ratePercent ?? 100)) / 100);
    if (earned > 0) {
      await tx.insert(loyaltyTransactionsTable).values({
        patientId,
        paymentId,
        delta: earned,
        amount: amountPaid,
        type: "earn",
        description: `کسب ${fa(earned)} امتیاز از پرداخت ${fa(amountPaid)} تومان${serviceName ? ` — ${serviceName}` : ""}`,
      });
    }
  }

  return { earned, redeemed: redeemPoints, redeemedValue };
}

/**
 * برگرداندن آثار امتیازی یک پرداخت هنگام حذف آن (داخل همان تراکنش حذف):
 * برای هر تراکنش امتیازیِ این پرداخت یک ردیف «reverse» با دلتای معکوس درج می‌شود
 * تا سابقه بماند. اگر برگردان باعث منفی‌شدن موجودی مراجع شود (امتیازِ کسب‌شده از
 * این پرداخت قبلاً خرج شده)، خطا پرتاب می‌شود و کل حذف لغو می‌گردد.
 */
export async function reverseLoyaltyForPayment(tx: LoyaltyExecutor, paymentId: number): Promise<number> {
  const rows = await tx
    .select()
    .from(loyaltyTransactionsTable)
    .where(eq(loyaltyTransactionsTable.paymentId, paymentId));
  // فقط ردیف‌های اصلی (کسب/خرج/امتیاز معرفیِ همین پرداخت) برگردانده می‌شوند؛
  // ردیف‌های reverse قبلی دوباره معکوس نمی‌شوند
  const originals = rows.filter((r) => ["earn", "redeem", "referral", "cashback"].includes(r.type));
  if (originals.length === 0) return 0;

  for (const t of originals) {
    await tx.insert(loyaltyTransactionsTable).values({
      patientId: t.patientId,
      paymentId,
      delta: -t.delta,
      amount: t.amount,
      type: "reverse",
      description:
        t.type === "earn"
          ? `برگردان ${fa(t.delta)} امتیازِ کسب‌شده (حذف پرداخت)`
          : t.type === "cashback"
            ? `برگردان ${fa(t.amount)} تومان اعتبار سود (حذف پرداخت)`
            : t.type === "referral"
              ? `برگردان ${fa(t.amount)} تومان اعتبار معرفی (حذف پرداخت)`
              : `برگردان ${fa(-t.delta)} امتیازِ استفاده‌شده (حذف پرداخت)`,
    });
  }

  const patientIds = [...new Set(originals.map((t) => t.patientId))];
  for (const pid of patientIds) {
    const balance = await getLoyaltyBalance(tx, pid);
    if (balance < 0) throw new Error(LOYALTY_ERRORS.negativeOnDelete);
  }
  return originals.length;
}

// ── عضویت خودکار ────────────────────────────────────────────────────────────

export interface MembershipUpdate {
  /** همین پرداخت مراجع را عضو کرد */
  joined: boolean;
  /** سطح بالا رفت */
  tierUp: boolean;
  tier: LoyaltyTier;
  /** امتیاز معرفی داده‌شده به معرفِ این مراجع (اولین پرداختِ او) */
  referral: { referrerId: number; points: number } | null;
}

/** سطح فعلی عضو (برای ضریب امتیاز همین پرداخت)؛ غیرعضو = برنزی */
export async function getMemberTier(executor: LoyaltyExecutor, patientId: number): Promise<LoyaltyTier> {
  const m = await executor.select({ tier: loyaltyMembersTable.tier }).from(loyaltyMembersTable)
    .where(eq(loyaltyMembersTable.patientId, patientId)).get();
  return isLoyaltyTier(m?.tier) ? m.tier : "bronze";
}

/**
 * پس از ثبت پرداخت (داخل همان تراکنش): عضویت خودکار، به‌روزرسانی سطح و امتیاز معرفی.
 * باید بعد از درج ردیف پرداخت صدا زده شود تا همین پرداخت در مجموع ۱۲ ماه حساب شود.
 */
export async function updateMembershipAfterPayment(
  tx: LoyaltyExecutor,
  args: { patientId: number; paymentId: number; settings: LoyaltySettings; nowSec: number; patientName?: string | null },
): Promise<MembershipUpdate> {
  const { patientId, paymentId, settings, nowSec } = args;
  const spend = (await getSpend12m(tx, nowSec, patientId)).get(patientId) ?? 0;
  const newTier = tierForSpend(spend, settings);

  const existing = await tx.select().from(loyaltyMembersTable).where(eq(loyaltyMembersTable.patientId, patientId)).get();
  let joined = false;
  let tierUp = false;
  let tier: LoyaltyTier = newTier;
  if (!existing) {
    await tx.insert(loyaltyMembersTable).values({ patientId, tier: newTier, joinedAt: nowSec, tierUpdatedAt: nowSec, welcomed: false });
    joined = true;
  } else if (tierRank(newTier) > tierRank(existing.tier)) {
    await tx.update(loyaltyMembersTable).set({ tier: newTier, tierUpdatedAt: nowSec }).where(eq(loyaltyMembersTable.patientId, patientId));
    tierUp = true;
  } else {
    // کاهش سطح فقط در دور روزانه انجام می‌شود (پرداخت هیچ‌وقت سطح را پایین نمی‌آورد)
    tier = isLoyaltyTier(existing.tier) ? existing.tier : newTier;
  }

  // امتیاز معرفی: فقط در اولین پرداختِ مراجعی که «مراجع» دیگری معرفش است
  let referral: MembershipUpdate["referral"] = null;
  if (settings.referralBonus > 0) {
    const patient = await tx.select({ referrerType: patientsTable.referrerType, referrerId: patientsTable.referrerId })
      .from(patientsTable).where(eq(patientsTable.id, patientId)).get();
    if (patient?.referrerType === "patient" && patient.referrerId && patient.referrerId !== patientId) {
      const [{ count }] = await tx.all<{ count: number }>(sql`
        SELECT COUNT(*) AS count FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id
        WHERE a.patient_id = ${patientId}
      `);
      // یک‌بار برای هر معرَّف: اگر امتیاز معرفیِ یکی از پرداخت‌های همین مراجع هنوز
      // وجود دارد، دوباره داده نمی‌شود. (اگر آن پرداخت حذف شده باشد، امتیازش هم
      // برگردانده شده و پرداختِ جایگزین دوباره امتیاز می‌دهد.)
      const already = await tx.all<{ id: number }>(sql`
        SELECT t.id AS id FROM loyalty_transactions t
        INNER JOIN payments p ON p.id = t.payment_id
        INNER JOIN appointments a ON a.id = p.appointment_id
        WHERE t.type = 'referral' AND a.patient_id = ${patientId} AND p.id <> ${paymentId}
      `);
      if (Number(count) === 1 && already.length === 0) {
        const description = `اعتبار معرفی ${args.patientName ?? "مراجع"}: ${fa(settings.referralBonus)} تومان`;
        await creditWallet(tx, patient.referrerId, settings.referralBonus, "loyalty_referral", description, paymentId);
        await tx.insert(loyaltyTransactionsTable).values({
          patientId: patient.referrerId,
          paymentId,
          delta: 0,
          amount: settings.referralBonus,
          type: "referral",
          description,
        });
        referral = { referrerId: patient.referrerId, points: settings.referralBonus };
      }
    }
  }

  return { joined, tierUp, tier, referral };
}

/**
 * عضویت یک‌جای مراجعینی که از قبل پرداخت داشته‌اند (بدون پیامک خوش‌آمد) و تعیین سطحشان.
 * تاریخ عضویت = تاریخ اولین پرداخت. اجرای دوباره بی‌اثر است.
 */
export async function backfillLoyaltyMembers(nowSec: number): Promise<number> {
  const settings = await getLoyaltySettings();
  if (!settings.enabled) return 0;
  const rows = await db.all<{ patient_id: number; first_paid: number }>(sql`
    SELECT a.patient_id AS patient_id, MIN(p.paid_at) AS first_paid
    FROM payments p INNER JOIN appointments a ON a.id = p.appointment_id
    INNER JOIN patients pt ON pt.id = a.patient_id
    WHERE NOT EXISTS (SELECT 1 FROM loyalty_members m WHERE m.patient_id = a.patient_id)
    GROUP BY a.patient_id
  `);
  if (rows.length === 0) return 0;
  const spend = await getSpend12m(db, nowSec);
  for (const r of rows) {
    const pid = Number(r.patient_id);
    await db.insert(loyaltyMembersTable).values({
      patientId: pid,
      tier: tierForSpend(spend.get(pid) ?? 0, settings),
      joinedAt: Number(r.first_paid) || nowSec,
      tierUpdatedAt: nowSec,
      welcomed: true,
    }).onConflictDoNothing();
  }
  return rows.length;
}

/** بازمحاسبهٔ سطح همهٔ اعضا (دور روزانه): کاهش سطح بی‌صدا؛ خروجی = تعداد تغییرها */
export async function recomputeAllTiers(nowSec: number, settings: LoyaltySettings): Promise<number> {
  const spend = await getSpend12m(db, nowSec);
  const members = await db.select().from(loyaltyMembersTable);
  let changed = 0;
  for (const m of members) {
    const tier = tierForSpend(spend.get(m.patientId) ?? 0, settings);
    if (tier !== m.tier) {
      await db.update(loyaltyMembersTable).set({ tier, tierUpdatedAt: nowSec }).where(eq(loyaltyMembersTable.patientId, m.patientId));
      changed++;
    }
  }
  return changed;
}

// ── انقضای امتیاز (FIFO) ────────────────────────────────────────────────────

const DAY_SEC = 86_400;
const MONTH_SEC = 30 * DAY_SEC;

export interface ExpiryLot {
  /** شناسهٔ تراکنشِ کسبِ این بسته */
  lotId: number;
  remaining: number;
  expiresAt: number;
}

/**
 * از تاریخچهٔ تراکنش‌های یک مراجع (به ترتیب زمان)، بسته‌های امتیاز را می‌سازد:
 * هر ردیف مثبت یک بسته است؛ ردیف‌های منفی از قدیمی‌ترین بسته کم می‌کنند، جز «برگردانِ کسب»
 * که از بستهٔ همان پرداخت کم می‌کند. خروجی: بسته‌های مانده‌دار با تاریخ انقضا.
 */
export function remainingLots(
  txns: Array<{ id: number; delta: number; type: string; paymentId: number | null; createdAt: number }>,
  expiryMonths: number,
): ExpiryLot[] {
  const lots: Array<ExpiryLot & { paymentId: number | null; type: string }> = [];
  const take = (lot: ExpiryLot, want: number) => {
    const used = Math.min(lot.remaining, want);
    lot.remaining -= used;
    return want - used;
  };
  for (const t of [...txns].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id)) {
    if (t.delta > 0) {
      lots.push({ lotId: t.id, remaining: t.delta, expiresAt: t.createdAt + expiryMonths * MONTH_SEC, paymentId: t.paymentId, type: t.type });
      continue;
    }
    let want = -t.delta;
    if (t.type === "reverse" && t.paymentId != null) {
      for (const lot of lots) {
        if (want <= 0) break;
        if (lot.paymentId === t.paymentId && (lot.type === "earn" || lot.type === "referral")) want = take(lot, want);
      }
    }
    for (const lot of lots) {
      if (want <= 0) break;
      want = take(lot, want);
    }
  }
  return lots.filter((l) => l.remaining > 0).map(({ lotId, remaining, expiresAt }) => ({ lotId, remaining, expiresAt }));
}

// انقضا فقط روی «اعتبار هدیهٔ باشگاه» در کیف پول اعمال می‌شود (سود خدمت، تولد، معرفی،
// افزودن دستی)؛ پولی که خود مراجع به کیف پول شارژ کرده هرگز منقضی نمی‌شود. برداشت‌ها از
// کیف پول اول از قدیمی‌ترین اعتبار هدیه کم می‌شوند.
export const WALLET_REWARD_TYPES = ["loyalty_cashback", "loyalty_birthday", "loyalty_referral", "loyalty_adjust"];
const WALLET_CONSUMER_TYPES = ["deduct", "loyalty_expire", "loyalty_adjust"];

async function walletRewardLots(patientId: number, expiryMonths: number): Promise<ExpiryLot[]> {
  const rows = await db.select().from(patientAccountTransactionsTable)
    .where(eq(patientAccountTransactionsTable.patientId, patientId));
  const relevant = rows
    // ردیف منفی از نوع پاداش (اصلاح اعتبار سود پس از حذف پرداخت) هم مصرف‌کننده است
    .filter((r) => (r.amount > 0 && WALLET_REWARD_TYPES.includes(r.type)) ||
      (r.amount < 0 && (WALLET_CONSUMER_TYPES.includes(r.type) || WALLET_REWARD_TYPES.includes(r.type))))
    .map((r) => ({ id: r.id, delta: r.amount, type: r.type, paymentId: null, createdAt: r.createdAt }));
  return remainingLots(relevant, expiryMonths);
}

/** اعتبار هدیهٔ منقضی‌شده را از کیف پول کم می‌کند؛ خروجی = جمع مبلغ منقضی‌شده (تومان) */
export async function expireLoyaltyPoints(nowSec: number, settings: LoyaltySettings): Promise<number> {
  if (settings.expiryMonths <= 0) return 0;
  const members = await db.select({ patientId: loyaltyMembersTable.patientId }).from(loyaltyMembersTable);
  let total = 0;
  for (const { patientId } of members) {
    const expired = (await walletRewardLots(patientId, settings.expiryMonths)).filter((l) => l.expiresAt <= nowSec);
    const due = expired.reduce((sum, l) => sum + l.remaining, 0);
    if (due <= 0) continue;
    const p = await db.select({ balance: patientsTable.accountBalance }).from(patientsTable)
      .where(eq(patientsTable.id, patientId)).get();
    const amount = Math.min(due, Math.max(0, p?.balance ?? 0));
    if (amount <= 0) continue;
    const description = `انقضای ${fa(amount)} تومان اعتبار باشگاه (بیش از ${fa(settings.expiryMonths)} ماه از دریافت گذشته)`;
    await db.transaction(async (tx) => {
      await creditWallet(tx, patientId, -amount, "loyalty_expire", description);
      await tx.insert(loyaltyTransactionsTable).values({ patientId, delta: 0, amount, type: "expire", description });
    });
    total += amount;
  }
  return total;
}

/** اعتبار هدیه‌ای که ظرف withinDays روز آینده منقضی می‌شود (تومان) — برای پیامک هشدار و نمای کلی */
export async function getExpiringSoon(
  nowSec: number,
  settings: LoyaltySettings,
  withinDays: number,
): Promise<Array<{ patientId: number; points: number; expiresAt: number; lotIds: number[] }>> {
  if (settings.expiryMonths <= 0) return [];
  const members = await db.select({ patientId: loyaltyMembersTable.patientId, balance: patientsTable.accountBalance })
    .from(loyaltyMembersTable).innerJoin(patientsTable, eq(patientsTable.id, loyaltyMembersTable.patientId));
  const out: Array<{ patientId: number; points: number; expiresAt: number; lotIds: number[] }> = [];
  for (const m of members) {
    if (m.balance <= 0) continue;
    const soon = (await walletRewardLots(m.patientId, settings.expiryMonths))
      .filter((l) => l.expiresAt > nowSec && l.expiresAt <= nowSec + withinDays * DAY_SEC);
    if (soon.length === 0) continue;
    out.push({
      patientId: m.patientId,
      // «points» این‌جا مبلغ تومانی است (حداکثر به اندازهٔ موجودی کیف پول)
      points: Math.min(m.balance, soon.reduce((s, l) => s + l.remaining, 0)),
      expiresAt: Math.min(...soon.map((l) => l.expiresAt)),
      lotIds: soon.map((l) => l.lotId),
    });
  }
  return out;
}

/** امتیاز هدیهٔ تولد: یک‌بار در سال (اگر در ۳۰۰ روز گذشته داده نشده باشد) */
export async function grantBirthdayBonus(patientId: number, nowSec: number, settings: LoyaltySettings): Promise<number> {
  if (!settings.enabled || settings.birthdayBonus <= 0) return 0;
  const member = await db.select({ id: loyaltyMembersTable.patientId }).from(loyaltyMembersTable)
    .where(eq(loyaltyMembersTable.patientId, patientId)).get();
  if (!member) return 0;
  const recent = await db.select({ id: loyaltyTransactionsTable.id }).from(loyaltyTransactionsTable)
    .where(and(eq(loyaltyTransactionsTable.patientId, patientId), eq(loyaltyTransactionsTable.type, "birthday"),
      gte(loyaltyTransactionsTable.createdAt, nowSec - 300 * DAY_SEC))).get();
  if (recent) return 0;
  const description = `هدیهٔ تولد: ${fa(settings.birthdayBonus)} تومان اعتبار`;
  await db.transaction(async (tx) => {
    await creditWallet(tx, patientId, settings.birthdayBonus, "loyalty_birthday", description, null, nowSec);
    await tx.insert(loyaltyTransactionsTable).values({
      patientId, delta: 0, amount: settings.birthdayBonus, type: "birthday", description, createdAt: nowSec,
    });
  });
  return settings.birthdayBonus;
}

/** امتیاز هدیهٔ تولدی که امروز (۲۴ ساعت اخیر) به مراجع داده شده؛ برای متن پیامک تبریک */
export async function getTodaysBirthdayBonus(patientId: number, nowSec: number): Promise<number> {
  const row = await db.select({ amount: loyaltyTransactionsTable.amount }).from(loyaltyTransactionsTable)
    .where(and(eq(loyaltyTransactionsTable.patientId, patientId), eq(loyaltyTransactionsTable.type, "birthday"),
      gte(loyaltyTransactionsTable.createdAt, nowSec - DAY_SEC))).get();
  return row?.amount ?? 0;
}

/** افزودن/کسر دستی اعتبار کیف پول از صفحهٔ باشگاه (فقط مدیر)؛ خروجی = موجودی جدید کیف پول */
export async function adjustLoyaltyPoints(patientId: number, amount: number, description: string): Promise<number> {
  return db.transaction(async (tx) => {
    const p = await tx.select({ balance: patientsTable.accountBalance }).from(patientsTable)
      .where(eq(patientsTable.id, patientId)).get();
    if (!p) throw new Error(LOYALTY_ERRORS.insufficient);
    if (p.balance + amount < 0) throw new Error(LOYALTY_ERRORS.insufficient);
    const text = description || (amount > 0 ? `افزودن دستی ${fa(amount)} تومان اعتبار` : `کسر دستی ${fa(-amount)} تومان اعتبار`);
    await creditWallet(tx, patientId, amount, "loyalty_adjust", text);
    // مبلغ با علامت ذخیره می‌شود تا کسر دستی در سابقه منفی نمایش داده شود
    await tx.insert(loyaltyTransactionsTable).values({ patientId, delta: 0, amount, type: "adjust", description: text });
    return p.balance + amount;
  });
}

// ── کیف پول و پاداش سود خدمت ────────────────────────────────────────────────

/** ثبت تراکنش کیف پول مراجع و به‌روزرسانی موجودی (مثبت = شارژ، منفی = کسر) */
export async function creditWallet(
  tx: LoyaltyExecutor,
  patientId: number,
  amount: number,
  type: string,
  description: string,
  paymentId: number | null = null,
  createdAt?: number,
): Promise<void> {
  if (amount === 0) return;
  await tx.insert(patientAccountTransactionsTable).values({
    patientId, amount, type, description, paymentId, ...(createdAt ? { createdAt } : {}),
  });
  await tx.update(patientsTable)
    .set({ accountBalance: sql`${patientsTable.accountBalance} + ${amount}` })
    .where(eq(patientsTable.id, patientId));
}

export async function getWalletBalance(executor: LoyaltyExecutor, patientId: number): Promise<number> {
  const p = await executor.select({ balance: patientsTable.accountBalance }).from(patientsTable)
    .where(eq(patientsTable.id, patientId)).get();
  return p?.balance ?? 0;
}

/**
 * هزینهٔ خدمتِ یک نوبت (حق‌الزحمهٔ پزشک + مواد + سایر)، با همان قاعدهٔ حسابداری:
 * هزینه‌های «per_unit» × واحد مصرفی (واحد همین پرداخت، یا واحد ثبت‌شده در نوبت، یا تعداد واحد خدمت).
 */
export async function appointmentServiceCost(tx: LoyaltyExecutor, appointmentId: number, unitsOverride?: number | null): Promise<number> {
  const override = unitsOverride && unitsOverride > 0 ? unitsOverride : null;
  const units = sql`COALESCE(${override}, a.units_used, s.unit_count, 1)`;
  const rows = await tx.all<{ cost: number }>(sql`
    SELECT
      (CASE WHEN s.doctor_fee_mode = 'per_unit' THEN COALESCE(s.doctor_fee, 0) * ${units} ELSE COALESCE(s.doctor_fee, 0) END) +
      (CASE WHEN s.material_cost_mode = 'per_unit' THEN COALESCE(s.material_cost, 0) * ${units} ELSE COALESCE(s.material_cost, 0) END) +
      (CASE WHEN s.other_cost_mode = 'per_unit' THEN COALESCE(s.other_cost, 0) * ${units} ELSE COALESCE(s.other_cost, 0) END) AS cost
    FROM appointments a INNER JOIN services s ON s.id = a.service_id
    WHERE a.id = ${appointmentId}
  `);
  return Number(rows[0]?.cost ?? 0);
}

/** اعتبار سود: درصدی از سود با ضریب سطح، گرد به پایین تا هزار تومان */
export function computeProfitReward(profit: number, percent: number, ratePercent = 100): number {
  if (!(profit > 0) || !(percent > 0)) return 0;
  const raw = (profit * percent * ratePercent) / 10_000;
  return Math.floor(raw / 1000) * 1000;
}

/**
 * پاداش اصلی باشگاه: درصدی از سود خدمت به کیف پول مراجع (داخل تراکنش پرداخت).
 * سود برای کل نوبت حساب می‌شود: (جمع پرداخت‌های نقدی این نوبت تا الان − هزینهٔ خدمت)؛
 * پاداش این پرداخت = پاداشِ کل تا الان − پاداش‌های قبلیِ همین نوبت. پس بیعانه + پرداخت
 * نهایی دقیقاً همان پاداشی را می‌دهند که یک پرداخت یک‌جا می‌داد، و تا هزینهٔ خدمت پوشش
 * داده نشده پاداشی داده نمی‌شود. مبلغ پرداخت‌شده از کیف پول یا امتیاز جزو «نقدی» نیست.
 */
export async function applyProfitCashback(
  tx: LoyaltyExecutor,
  args: {
    patientId: number;
    paymentId: number;
    appointmentId: number;
    unitsUsed?: number | null;
    settings: LoyaltySettings;
    ratePercent: number;
    serviceName?: string | null;
  },
): Promise<{ reward: number; profit: number }> {
  const { patientId, paymentId, appointmentId, settings } = args;
  if (!settings.enabled || settings.profitRewardPercent <= 0 || !(appointmentId > 0)) return { reward: 0, profit: 0 };

  const cost = await appointmentServiceCost(tx, appointmentId, args.unitsUsed);
  const [{ paid }] = await tx.all<{ paid: number }>(sql`
    SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE appointment_id = ${appointmentId}
  `);
  const [{ rewarded }] = await tx.all<{ rewarded: number }>(sql`
    SELECT COALESCE(SUM(t.amount), 0) AS rewarded FROM patient_account_transactions t
    INNER JOIN payments p ON p.id = t.payment_id
    WHERE p.appointment_id = ${appointmentId} AND t.type = 'loyalty_cashback' AND p.id <> ${paymentId}
  `);
  const profit = Number(paid) - cost;
  const target = computeProfitReward(profit, settings.profitRewardPercent, args.ratePercent);
  const reward = Math.max(0, target - Number(rewarded));
  if (reward <= 0) return { reward: 0, profit };

  const description =
    `اعتبار سود خدمت${args.serviceName ? ` (${args.serviceName})` : ""}: ` +
    `${fa(settings.profitRewardPercent * args.ratePercent / 100)}٪ سود — ${fa(reward)} تومان`;
  await creditWallet(tx, patientId, reward, "loyalty_cashback", description, paymentId);
  await tx.insert(loyaltyTransactionsTable).values({
    patientId, paymentId, delta: 0, amount: reward, type: "cashback", description,
  });
  return { reward, profit };
}

export const WALLET_NEGATIVE_ERROR = "WALLET_NEGATIVE";

/**
 * پس از حذف یک پرداخت (داخل تراکنش حذف، بعد از برگرداندن تراکنش‌های خود آن پرداخت):
 * اعتبار سودِ نوبت بر اساس پرداخت‌های باقی‌مانده دوباره حساب می‌شود. چون پاداش هر
 * پرداخت «تجمعی» است، حذف مثلاً بیعانه باعث می‌شد پاداشی که پرداخت نهایی با احتساب
 * بیعانه گرفته اضافه بماند؛ مازاد از کیف پول کم و به آخرین پرداخت باقی‌مانده وصل
 * می‌شود (تا اگر آن هم حذف شد، درست برگردد). هرگز اعتبار اضافه نمی‌کند.
 * اگر مازاد قبلاً خرج شده باشد (موجودی منفی شود) خطای WALLET_NEGATIVE پرتاب می‌شود.
 */
export async function reconcileAppointmentCashback(
  tx: LoyaltyExecutor,
  appointmentId: number,
  deleted: { amount: number; cashback: number },
): Promise<number> {
  if (!(appointmentId > 0)) return 0;
  const [row] = await tx.all<{ patient_id: number; paid: number; last_payment_id: number | null; units_used: number | null; rewarded: number }>(sql`
    SELECT a.patient_id AS patient_id,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.appointment_id = a.id) AS paid,
      (SELECT MAX(p.id) FROM payments p WHERE p.appointment_id = a.id) AS last_payment_id,
      (SELECT p.units_used FROM payments p WHERE p.appointment_id = a.id ORDER BY p.id DESC LIMIT 1) AS units_used,
      (SELECT COALESCE(SUM(t.amount), 0) FROM patient_account_transactions t INNER JOIN payments p ON p.id = t.payment_id
        WHERE p.appointment_id = a.id AND t.type = 'loyalty_cashback') AS rewarded
    FROM appointments a WHERE a.id = ${appointmentId}
  `);
  const rewarded = Number(row?.rewarded ?? 0);
  if (!row || row.last_payment_id == null || !(rewarded > 0)) return 0;
  const pid = Number(row.patient_id);
  const cost = await appointmentServiceCost(tx, appointmentId, row.units_used);
  // نرخ مؤثری که واقعاً داده شده بود (مستقل از تغییر بعدی درصد یا سطح):
  // پاداش کل قبل از حذف ÷ سود کل قبل از حذف
  const paidAfter = Number(row.paid);
  const profitBefore = paidAfter + deleted.amount - cost;
  if (!(profitBefore > 0)) return 0;
  const rewardedBefore = rewarded + Math.max(0, deleted.cashback);
  const profitAfter = paidAfter - cost;
  // اگر تنظیمات فعلی همان پاداش قبلی را می‌دهند، همان قاعده (بدون خطای گرد کردن)؛
  // وگرنه نرخ مؤثر قبلی
  const settings = await getLoyaltySettings();
  const tierPct = tierRate(await getMemberTier(tx, pid), settings);
  const target = computeProfitReward(profitBefore, settings.profitRewardPercent, tierPct) === rewardedBefore
    ? computeProfitReward(profitAfter, settings.profitRewardPercent, tierPct)
    : profitAfter > 0 ? Math.floor((profitAfter * rewardedBefore) / profitBefore / 1000 + 1e-9) * 1000 : 0;
  const excess = rewarded - target;
  if (excess <= 0) return 0;

  const paymentId = Number(row.last_payment_id);
  const description = `اصلاح اعتبار سود پس از حذف پرداخت: ${fa(excess)} تومان`;
  await creditWallet(tx, pid, -excess, "loyalty_cashback", description, paymentId);
  await tx.insert(loyaltyTransactionsTable).values({
    patientId: pid, paymentId, delta: 0, amount: -excess, type: "cashback", description,
  });
  if ((await getWalletBalance(tx, pid)) < 0) throw new Error(WALLET_NEGATIVE_ERROR);
  return excess;
}

// ── اعتبار سودِ پرداخت‌های قبلی ──────────────────────────────────────────────

export interface RetroCashbackPatient {
  patientId: number;
  name: string;
  phone: string | null;
  amount: number;
  appointments: number;
}

export interface RetroCashbackResult {
  appointments: number;
  patients: RetroCashbackPatient[];
  total: number;
}

/**
 * محاسبه (و در صورت apply ثبتِ) اعتبار سود برای نوبت‌های پرداخت‌شده‌ای که هنوز هیچ اعتبار
 * سودی نگرفته‌اند (مثلاً پرداخت‌های پیش از فعال شدن این قابلیت). بازه روی تاریخ آخرین
 * پرداخت نوبت است (ثانیه، to انحصاری). قاعدهٔ محاسبه همان پرداخت عادی است؛ ضریبِ سطحِ
 * فعلی عضو اعمال می‌شود. اعتبار به آخرین پرداخت نوبت وصل می‌شود (تا حذف آن پرداخت
 * برش گرداند) و تاریخش «الان» است تا انقضا از امروز حساب شود. اجرای دوباره بی‌اثر است.
 */
export async function retroProfitCashback(args: {
  fromSec?: number | null;
  toSec?: number | null;
  apply: boolean;
}): Promise<RetroCashbackResult> {
  const settings = await getLoyaltySettings();
  const empty: RetroCashbackResult = { appointments: 0, patients: [], total: 0 };
  if (!settings.enabled || settings.profitRewardPercent <= 0) return empty;

  const run = async (tx: LoyaltyExecutor): Promise<RetroCashbackResult> => {
    const rows = await tx.all<{
      appointment_id: number; patient_id: number; name: string; phone: string | null;
      paid: number; last_payment_id: number; units_used: number | null; service_name: string | null;
    }>(sql`
      SELECT a.id AS appointment_id, a.patient_id AS patient_id, pt.name AS name, pt.phone AS phone,
        SUM(p.amount) AS paid, MAX(p.id) AS last_payment_id,
        (SELECT lp.units_used FROM payments lp WHERE lp.appointment_id = a.id ORDER BY lp.id DESC LIMIT 1) AS units_used,
        (SELECT lp.service_name FROM payments lp WHERE lp.appointment_id = a.id ORDER BY lp.id DESC LIMIT 1) AS service_name
      FROM payments p
      INNER JOIN appointments a ON a.id = p.appointment_id
      INNER JOIN patients pt ON pt.id = a.patient_id
      WHERE NOT EXISTS (
        SELECT 1 FROM patient_account_transactions t INNER JOIN payments p2 ON p2.id = t.payment_id
        WHERE p2.appointment_id = a.id AND t.type = 'loyalty_cashback'
      )
      GROUP BY a.id
      HAVING (${args.fromSec ?? null} IS NULL OR MAX(p.paid_at) >= ${args.fromSec ?? null})
         AND (${args.toSec ?? null} IS NULL OR MAX(p.paid_at) < ${args.toSec ?? null})
      ORDER BY MAX(p.paid_at)
    `);

    const byPatient = new Map<number, RetroCashbackPatient>();
    let appointments = 0;
    let total = 0;
    const tierCache = new Map<number, number>();
    for (const r of rows) {
      const pid = Number(r.patient_id);
      let rate = tierCache.get(pid);
      if (rate === undefined) {
        rate = tierRate(await getMemberTier(tx, pid), settings);
        tierCache.set(pid, rate);
      }
      const cost = await appointmentServiceCost(tx, Number(r.appointment_id), r.units_used);
      const reward = computeProfitReward(Number(r.paid) - cost, settings.profitRewardPercent, rate);
      if (reward <= 0) continue;

      if (args.apply) {
        const description =
          `اعتبار سود خدمت قبلی${r.service_name ? ` (${r.service_name})` : ""}: ` +
          `${fa(settings.profitRewardPercent * rate / 100)}٪ سود — ${fa(reward)} تومان`;
        const paymentId = Number(r.last_payment_id);
        await creditWallet(tx, pid, reward, "loyalty_cashback", description, paymentId);
        await tx.insert(loyaltyTransactionsTable).values({
          patientId: pid, paymentId, delta: 0, amount: reward, type: "cashback", description,
        });
      }
      appointments++;
      total += reward;
      const entry = byPatient.get(pid) ?? { patientId: pid, name: r.name, phone: r.phone, amount: 0, appointments: 0 };
      entry.amount += reward;
      entry.appointments++;
      byPatient.set(pid, entry);
    }
    const patients = [...byPatient.values()].sort((a, b) => b.amount - a.amount);
    return { appointments, patients, total };
  };

  return args.apply ? db.transaction(run) : run(db);
}
