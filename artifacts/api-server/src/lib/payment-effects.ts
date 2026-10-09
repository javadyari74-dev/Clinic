import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  appointmentsTable,
  commissionRecipientsTable,
  commissionsTable,
  discountsTable,
  patientAccountTransactionsTable,
  patientsTable,
  paymentsTable,
  remindersTable,
  staffTable,
} from "@workspace/db";
import {
  LOYALTY_ERRORS,
  WALLET_NEGATIVE_ERROR,
  reconcileAppointmentCashback,
  reverseLoyaltyForPayment,
  type LoyaltyExecutor,
} from "./loyalty";
import { fireCommissionSms } from "./sms";
import { logger } from "./logger";

// ── آثار مالی پرداخت‌ها ─────────────────────────────────────────────────────
// منطق مشترکِ ثبت بیعانه، پورسانت خودکار معرف و برگرداندن کامل یک پرداخت
// این‌جا متمرکز است تا مسیرهای پرداخت، نوبت، لیست انتظار و حذف مراجع همگی
// از یک منبع استفاده کنند و هیچ اثری (کیف پول، کمیسیون، تخفیف، امتیاز، یادآوری)
// جا نماند.

export type Tx = LoyaltyExecutor;
type PaymentRow = typeof paymentsTable.$inferSelect;
type PatientRow = typeof patientsTable.$inferSelect;

/** یادداشت ردیف پرداختِ بیعانه (هنگام ثبت نوبت ساخته می‌شود) */
export const DEPOSIT_NOTE = "بیعانه";

export function isDepositPayment(p: { notes?: string | null }): boolean {
  return (p.notes ?? "") === DEPOSIT_NOTE;
}

/** خطای قابل‌نمایش به کاربر (پیام فارسی + کد HTTP) — کل تراکنش را برمی‌گرداند */
export class PaymentEffectError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "PaymentEffectError";
  }
}

export const PAYMENT_EFFECT_MESSAGES = {
  paidCommission: "پورسانت این پرداخت تسویه شده است؛ ابتدا تسویه را برگردانید",
  walletNegative: "اعتباری که این پرداخت به کیف پول مراجع داده قبلاً خرج شده است؛ حذف این پرداخت ممکن نیست",
  loyaltyNegative: "امتیازهای کسب‌شده از این پرداخت قبلاً استفاده شده‌اند؛ ابتدا باید امتیازهای استفاده‌شده برگردانده شود",
} as const;

/** جمع مبلغ پرداخت‌شدهٔ یک ردیف پرداخت (نقدی + کیف پول + امتیاز) */
export const paymentTotal = (p: { amount: number; walletAmount?: number | null; pointsAmount?: number | null }) =>
  p.amount + (p.walletAmount ?? 0) + (p.pointsAmount ?? 0);

/** عبارت SQL جمع پرداخت‌های یک نوبت (برای انتخاب در کوئری‌های نوبت) */
export const PAID_TOTAL_SQL = (appointmentId: unknown) => sql<number>`(
  SELECT COALESCE(SUM(p.amount + COALESCE(p.wallet_amount, 0) + COALESCE(p.points_amount, 0)), 0)
  FROM payments p WHERE p.appointment_id = ${appointmentId}
)`;

/** وضعیت پرداخت یک نوبت: جمع پرداخت‌ها و اینکه پرداخت تسویه (غیر از بیعانه) دارد یا نه */
export async function appointmentPaymentState(tx: Tx, appointmentId: number): Promise<{ paid: number; hasCheckout: boolean; count: number }> {
  const [row] = await tx.all<{ paid: number; checkout: number; cnt: number }>(sql`
    SELECT
      COALESCE(SUM(amount + COALESCE(wallet_amount, 0) + COALESCE(points_amount, 0)), 0) AS paid,
      COALESCE(SUM(CASE WHEN COALESCE(notes, '') <> ${DEPOSIT_NOTE} THEN 1 ELSE 0 END), 0) AS checkout,
      COUNT(*) AS cnt
    FROM payments WHERE appointment_id = ${appointmentId}
  `);
  return { paid: Number(row?.paid ?? 0), hasCheckout: Number(row?.checkout ?? 0) > 0, count: Number(row?.cnt ?? 0) };
}

/**
 * پس از حذف یک پرداخت: وضعیت نوبت دوباره محاسبه می‌شود. اگر پرداخت تسویه‌ای نماند،
 * قیمت و واحد مصرفیِ ثبت‌شده در صندوق پاک می‌شود؛ اگر مبلغ پرداخت‌شده از قیمت کمتر
 * شود، نوبتِ «تکمیل شده» دوباره «تایید شده» (باز) می‌شود.
 */
export async function recomputeAppointmentAfterPaymentChange(tx: Tx, appointmentId: number | null | undefined): Promise<void> {
  if (!appointmentId || appointmentId <= 0) return;
  const appt = await tx.select().from(appointmentsTable).where(eq(appointmentsTable.id, appointmentId)).get();
  if (!appt) return;
  const state = await appointmentPaymentState(tx, appointmentId);
  const changes: Partial<typeof appointmentsTable.$inferInsert> = {};
  let open = false;
  if (!state.hasCheckout) {
    changes.price = null;
    changes.unitsUsed = null;
    open = true;
  } else if (appt.price != null && state.paid < appt.price) {
    open = true;
  }
  if (open && appt.status === "completed") changes.status = "confirmed";
  if (Object.keys(changes).length > 0) {
    await tx.update(appointmentsTable).set(changes).where(eq(appointmentsTable.id, appointmentId));
  }
}

// ── پورسانت خودکار معرف ─────────────────────────────────────────────────────

export interface ReferrerAccrual {
  recipientType: "staff" | "external";
  recipientId: number;
  amount: number;
  rate: number;
  baseAmount: number;
  recipientName: string;
  recipientPhone: string | null;
}

/** گیرندهٔ پورسانت خودکارِ معرفِ یک بیمار (کارمند یا کمیسیون‌گیرنده/لیزر)، یا null */
export function automaticReferrerOf(patient: Pick<PatientRow, "referrerType" | "referrerId" | "referrerRate"> | null | undefined):
  { recipientType: "staff" | "external"; recipientId: number; rate: number } | null {
  if (!patient?.referrerType || patient.referrerType === "patient") return null;
  if (!patient.referrerId || !patient.referrerRate || patient.referrerRate <= 0) return null;
  return {
    recipientType: patient.referrerType === "staff" ? "staff" : "external",
    recipientId: patient.referrerId,
    rate: patient.referrerRate,
  };
}

/**
 * پورسانت خودکارِ معرف (کارمند/کمیسیون‌گیرنده/لیزر) برای یک پرداخت — داخل تراکنش همان پرداخت.
 * پایه: مبلغ نقدیِ همین پرداخت (برای بیعانه هم جداگانه ثبت می‌شود تا پایهٔ کل شامل بیعانه باشد).
 * اگر گیرنده دیگر وجود نداشته باشد، پورسانتی ثبت نمی‌شود.
 */
export async function accrueReferrerCommission(
  tx: Tx,
  args: { payment: Pick<PaymentRow, "id" | "amount" | "appointmentId">; patient: PatientRow | null | undefined },
): Promise<ReferrerAccrual | null> {
  const { payment, patient } = args;
  const ref = automaticReferrerOf(patient);
  if (!ref || !patient || !(payment.amount > 0)) return null;
  const amount = Math.round((payment.amount * ref.rate) / 100);
  if (amount <= 0) return null;
  const recipient = ref.recipientType === "staff"
    ? await tx.select({ name: staffTable.name, phone: staffTable.phone }).from(staffTable).where(eq(staffTable.id, ref.recipientId)).get()
    : await tx.select({ name: commissionRecipientsTable.name, phone: commissionRecipientsTable.phone }).from(commissionRecipientsTable).where(eq(commissionRecipientsTable.id, ref.recipientId)).get();
  if (!recipient) return null;
  const inserted = await tx.insert(commissionsTable).values({
    recipientType: ref.recipientType,
    recipientId: ref.recipientId,
    appointmentId: payment.appointmentId,
    paymentId: payment.id,
    amount,
    rate: ref.rate,
    description: `پورسانت معرفی بیمار «${patient.name}»`,
  }).onConflictDoNothing().returning({ id: commissionsTable.id });
  if (inserted.length === 0) return null;
  return {
    ...ref,
    amount,
    baseAmount: payment.amount,
    recipientName: recipient.name,
    recipientPhone: recipient.phone ?? null,
  };
}

/** پیامک اطلاع پورسانت خودکار — پس از commit تراکنش، آتش و فراموش */
export function fireReferrerCommissionSms(accrual: ReferrerAccrual | null): void {
  if (!accrual) return;
  try {
    fireCommissionSms({
      referrerName: accrual.recipientName,
      phone: accrual.recipientPhone,
      commissionAmount: accrual.amount,
      baseAmount: accrual.baseAmount,
      rate: accrual.rate,
    });
  } catch (err) {
    logger.warn({ err }, "commission SMS failed");
  }
}

// ── بیعانه ──────────────────────────────────────────────────────────────────

/**
 * ثبت ردیف پرداختِ بیعانهٔ یک نوبت (داخل تراکنش) + پورسانت خودکار معرف روی همان مبلغ.
 * در ثبت نوبت عادی و تبدیل لیست انتظار استفاده می‌شود.
 */
export async function recordDepositPayment(
  tx: Tx,
  args: {
    appointmentId: number;
    deposit: number;
    patientId: number;
    serviceName?: string | null;
    sessionNumber?: number | null;
    unitLabel?: string | null;
  },
): Promise<{ payment: PaymentRow; accrual: ReferrerAccrual | null } | null> {
  if (!(args.deposit > 0)) return null;
  const patient = await tx.select().from(patientsTable).where(eq(patientsTable.id, args.patientId)).get();
  const [payment] = await tx.insert(paymentsTable).values({
    appointmentId: args.appointmentId,
    amount: args.deposit,
    originalAmount: args.deposit,
    method: "cash",
    notes: DEPOSIT_NOTE,
    patientName: patient?.name ?? null,
    serviceName: args.serviceName ?? null,
    sessionNumber: args.sessionNumber ?? null,
    unitLabel: args.unitLabel ?? null,
    paidAt: Math.floor(Date.now() / 1000),
  }).returning();
  const accrual = await accrueReferrerCommission(tx, { payment, patient });
  return { payment, accrual };
}

// ── برگرداندن کامل یک پرداخت ────────────────────────────────────────────────

/**
 * پیش‌بررسی: اگر کمیسیونِ مرتبط با این پرداخت تسویه شده باشد، حذف ممکن نیست.
 * (کمیسیون‌های قدیمیِ بدون paymentId فقط وقتی حساب می‌شوند که این تنها پرداخت نوبت باشد.)
 */
async function linkedCommissionConditions(tx: Tx, payment: PaymentRow) {
  const conds = [eq(commissionsTable.paymentId, payment.id)];
  if (payment.appointmentId && payment.appointmentId > 0) {
    const others = await tx.select({ id: paymentsTable.id }).from(paymentsTable)
      .where(and(eq(paymentsTable.appointmentId, payment.appointmentId), ne(paymentsTable.id, payment.id)));
    if (others.length === 0) {
      const legacy = and(eq(commissionsTable.appointmentId, payment.appointmentId), isNull(commissionsTable.paymentId));
      if (legacy) conds.push(legacy);
    }
  }
  return conds;
}

/**
 * همهٔ آثار مالی یک پرداختِ «حذف‌شده» را داخل همان تراکنش برمی‌گرداند. ردیف پرداخت
 * باید قبلاً (اتمیک، با DELETE ... RETURNING) حذف شده باشد.
 *   ۱) کمیسیون‌های مرتبط (اگر یکی تسویه شده باشد → خطا)
 *   ۲) تراکنش‌های کیف پول مرتبط (کسر، اعتبار معرفی، اعتبار سود) + اصلاح موجودی
 *   ۳) اصلاح اعتبار سود تجمعیِ نوبت
 *   ۴) کاهش شمارش استفادهٔ تخفیف
 *   ۵) آثار امتیازی باشگاه
 *   ۶) یادآوری ساخته‌شده با همین پرداخت
 *   ۷) بازمحاسبهٔ وضعیت نوبت
 * گزینهٔ ignoreWalletOf برای حذف مراجع است: کیف پول خودِ مراجعِ در حال حذف بررسی نمی‌شود.
 */
export async function reversePaymentEffects(
  tx: Tx,
  payment: PaymentRow,
  opts: { ignoreWalletOf?: number; skipCashbackReconcile?: boolean; skipAppointmentRecompute?: boolean } = {},
): Promise<void> {
  // ۱) کمیسیون‌ها
  const commConds = await linkedCommissionConditions(tx, payment);
  for (const c of commConds) {
    const paid = await tx.select({ id: commissionsTable.id }).from(commissionsTable)
      .where(and(c, eq(commissionsTable.isPaid, true))).limit(1);
    if (paid.length > 0) throw new PaymentEffectError(PAYMENT_EFFECT_MESSAGES.paidCommission);
  }
  for (const c of commConds) await tx.delete(commissionsTable).where(c);

  // ۲) تراکنش‌های کیف پول: برعکس‌کردن هر تراکنش یعنی کم‌کردن «مبلغِ آن» از موجودی
  const linkedTxns = await tx.select().from(patientAccountTransactionsTable)
    .where(eq(patientAccountTransactionsTable.paymentId, payment.id));
  for (const t of linkedTxns) {
    await tx.update(patientsTable)
      .set({ accountBalance: sql`${patientsTable.accountBalance} - ${t.amount}` })
      .where(eq(patientsTable.id, t.patientId));
  }
  // اگر اعتبارِ داده‌شده از این پرداخت قبلاً خرج شده باشد، کیف پول منفی می‌شود → لغو
  for (const pid of new Set(linkedTxns.filter((t) => t.amount > 0).map((t) => t.patientId))) {
    if (pid === opts.ignoreWalletOf) continue;
    const p = await tx.select({ balance: patientsTable.accountBalance }).from(patientsTable).where(eq(patientsTable.id, pid)).get();
    if (p && p.balance < 0) throw new PaymentEffectError(PAYMENT_EFFECT_MESSAGES.walletNegative);
  }
  if (linkedTxns.length > 0) {
    await tx.delete(patientAccountTransactionsTable).where(eq(patientAccountTransactionsTable.paymentId, payment.id));
  }

  // ۳) اعتبار سود تجمعیِ نوبت (مثلاً حذف بیعانه)
  if (!opts.skipCashbackReconcile) {
    try {
      await reconcileAppointmentCashback(tx, payment.appointmentId, {
        amount: payment.amount,
        cashback: linkedTxns.filter((t) => t.type === "loyalty_cashback").reduce((sum, t) => sum + t.amount, 0),
      });
    } catch (err) {
      if (err instanceof Error && err.message === WALLET_NEGATIVE_ERROR) {
        throw new PaymentEffectError(PAYMENT_EFFECT_MESSAGES.walletNegative);
      }
      throw err;
    }
  }

  // ۴) شمارش استفادهٔ تخفیف (هرگز منفی نشود)
  if (payment.discountId) {
    await tx.update(discountsTable)
      .set({ usageCount: sql`MAX(usage_count - 1, 0)` })
      .where(eq(discountsTable.id, payment.discountId));
  }

  // ۵) امتیاز باشگاه
  try {
    await reverseLoyaltyForPayment(tx, payment.id);
  } catch (err) {
    if (err instanceof Error && err.message === LOYALTY_ERRORS.negativeOnDelete) {
      throw new PaymentEffectError(PAYMENT_EFFECT_MESSAGES.loyaltyNegative);
    }
    throw err;
  }

  // ۶) یادآوری پیگیریِ ساخته‌شده با همین پرداخت
  await tx.delete(remindersTable).where(eq(remindersTable.paymentId, payment.id));

  // ۷) وضعیت نوبت
  if (!opts.skipAppointmentRecompute) {
    await recomputeAppointmentAfterPaymentChange(tx, payment.appointmentId);
  }
}

/** آیا کمیسیونِ تسویه‌شده‌ای به این پرداخت‌ها/نوبت‌ها وصل است؟ */
export async function hasPaidCommissions(tx: Tx, args: { paymentIds: number[]; appointmentIds: number[] }): Promise<boolean> {
  const conds = [];
  if (args.paymentIds.length > 0) conds.push(inArray(commissionsTable.paymentId, args.paymentIds));
  if (args.appointmentIds.length > 0) conds.push(inArray(commissionsTable.appointmentId, args.appointmentIds));
  for (const c of conds) {
    const rows = await tx.select({ id: commissionsTable.id }).from(commissionsTable)
      .where(and(c, eq(commissionsTable.isPaid, true))).limit(1);
    if (rows.length > 0) return true;
  }
  return false;
}
