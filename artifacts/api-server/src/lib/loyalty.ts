import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  appSettingsTable,
  loyaltyTransactionsTable,
  loyaltyMembersTable,
  patientsTable,
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
  // امتیاز هدیهٔ تولد و معرفی دوست (۰ = خاموش)
  birthdayBonus: "loyalty_birthday_bonus",
  referralBonus: "loyalty_referral_bonus",
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
  birthdayBonus: number;
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
  birthdayBonus: 20,
  referralBonus: 50,
};

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
  if (settings.enabled) {
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
  const originals = rows.filter((r) => r.type === "earn" || r.type === "redeem" || r.type === "referral");
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
          : t.type === "referral"
            ? `برگردان ${fa(t.delta)} امتیازِ معرفی (حذف پرداخت)`
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
        await tx.insert(loyaltyTransactionsTable).values({
          patientId: patient.referrerId,
          paymentId,
          delta: settings.referralBonus,
          amount: 0,
          type: "referral",
          description: `امتیاز معرفی ${args.patientName ?? "مراجع"}`,
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

/** امتیازهای منقضی‌شده را با ردیف «expire» کم می‌کند؛ خروجی = جمع امتیاز منقضی‌شده */
export async function expireLoyaltyPoints(nowSec: number, settings: LoyaltySettings): Promise<number> {
  if (settings.expiryMonths <= 0) return 0;
  const members = await db.select({ patientId: loyaltyMembersTable.patientId }).from(loyaltyMembersTable);
  let total = 0;
  for (const { patientId } of members) {
    const txns = await db.select().from(loyaltyTransactionsTable).where(eq(loyaltyTransactionsTable.patientId, patientId));
    const expired = remainingLots(txns, settings.expiryMonths).filter((l) => l.expiresAt <= nowSec);
    const points = expired.reduce((sum, l) => sum + l.remaining, 0);
    if (points <= 0) continue;
    await db.insert(loyaltyTransactionsTable).values({
      patientId,
      delta: -points,
      amount: points * settings.redeemValue,
      type: "expire",
      description: `انقضای ${fa(points)} امتیاز (بیش از ${fa(settings.expiryMonths)} ماه از کسب گذشته)`,
    });
    total += points;
  }
  return total;
}

/** بسته‌هایی که ظرف withinDays روز آینده منقضی می‌شوند (برای پیامک هشدار و نمای کلی) */
export async function getExpiringSoon(
  nowSec: number,
  settings: LoyaltySettings,
  withinDays: number,
): Promise<Array<{ patientId: number; points: number; expiresAt: number; lotIds: number[] }>> {
  if (settings.expiryMonths <= 0) return [];
  const txns = await db.select().from(loyaltyTransactionsTable);
  const byPatient = new Map<number, typeof txns>();
  for (const t of txns) {
    const list = byPatient.get(t.patientId) ?? [];
    list.push(t);
    byPatient.set(t.patientId, list);
  }
  const out: Array<{ patientId: number; points: number; expiresAt: number; lotIds: number[] }> = [];
  for (const [patientId, list] of byPatient) {
    const soon = remainingLots(list, settings.expiryMonths)
      .filter((l) => l.expiresAt > nowSec && l.expiresAt <= nowSec + withinDays * DAY_SEC);
    if (soon.length === 0) continue;
    out.push({
      patientId,
      points: soon.reduce((s, l) => s + l.remaining, 0),
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
  await db.insert(loyaltyTransactionsTable).values({
    patientId,
    delta: settings.birthdayBonus,
    amount: 0,
    type: "birthday",
    description: `هدیهٔ تولد: ${fa(settings.birthdayBonus)} امتیاز`,
    createdAt: nowSec,
  });
  return settings.birthdayBonus;
}

/** امتیاز هدیهٔ تولدی که امروز (۲۴ ساعت اخیر) به مراجع داده شده؛ برای متن پیامک تبریک */
export async function getTodaysBirthdayBonus(patientId: number, nowSec: number): Promise<number> {
  const row = await db.select({ delta: loyaltyTransactionsTable.delta }).from(loyaltyTransactionsTable)
    .where(and(eq(loyaltyTransactionsTable.patientId, patientId), eq(loyaltyTransactionsTable.type, "birthday"),
      gte(loyaltyTransactionsTable.createdAt, nowSec - DAY_SEC))).get();
  return row?.delta ?? 0;
}

/** افزودن/کسر دستی امتیاز (فقط مدیر) */
export async function adjustLoyaltyPoints(patientId: number, points: number, description: string): Promise<number> {
  return db.transaction(async (tx) => {
    if (points < 0) {
      const balance = await getLoyaltyBalance(tx, patientId);
      if (balance + points < 0) throw new Error(LOYALTY_ERRORS.insufficient);
    }
    await tx.insert(loyaltyTransactionsTable).values({
      patientId,
      delta: points,
      amount: 0,
      type: "adjust",
      description: description || (points > 0 ? `افزودن دستی ${fa(points)} امتیاز` : `کسر دستی ${fa(-points)} امتیاز`),
    });
    return getLoyaltyBalance(tx, patientId);
  });
}
