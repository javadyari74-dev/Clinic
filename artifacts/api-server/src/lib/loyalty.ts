import { eq, inArray, sql } from "drizzle-orm";
import { db, appSettingsTable, loyaltyTransactionsTable } from "@workspace/db";

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
} as const;

export interface LoyaltySettings {
  enabled: boolean;
  /** به ازای هر این‌قدر تومان پرداخت، ۱ امتیاز */
  earnAmount: number;
  /** ارزش تومانی هر امتیاز هنگام استفاده */
  redeemValue: number;
  /** حداقل امتیاز لازم برای استفاده */
  minRedeem: number;
}

export const LOYALTY_DEFAULTS: LoyaltySettings = {
  enabled: false,
  earnAmount: 100_000,
  redeemValue: 10_000,
  minRedeem: 10,
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
  };
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
      description: `استفاده از ${redeemPoints} امتیاز (${redeemedValue.toLocaleString("fa-IR")} تومان)${serviceName ? ` — ${serviceName}` : ""}`,
    });
  }

  let earned = 0;
  if (settings.enabled) {
    earned = computeEarnPoints(amountPaid, settings.earnAmount);
    if (earned > 0) {
      await tx.insert(loyaltyTransactionsTable).values({
        patientId,
        paymentId,
        delta: earned,
        amount: amountPaid,
        type: "earn",
        description: `کسب ${earned} امتیاز از پرداخت ${amountPaid.toLocaleString("fa-IR")} تومان${serviceName ? ` — ${serviceName}` : ""}`,
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
  // فقط ردیف‌های اصلی (کسب/خرج) برگردانده می‌شوند؛ ردیف‌های reverse قبلی دوباره معکوس نمی‌شوند
  const originals = rows.filter((r) => r.type === "earn" || r.type === "redeem");
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
          ? `برگردان ${t.delta} امتیازِ کسب‌شده (حذف پرداخت)`
          : `برگردان ${-t.delta} امتیازِ استفاده‌شده (حذف پرداخت)`,
    });
  }

  const patientIds = [...new Set(originals.map((t) => t.patientId))];
  for (const pid of patientIds) {
    const balance = await getLoyaltyBalance(tx, pid);
    if (balance < 0) throw new Error(LOYALTY_ERRORS.negativeOnDelete);
  }
  return originals.length;
}
