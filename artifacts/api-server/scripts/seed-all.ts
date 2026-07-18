/**
 * Comprehensive demo seed for the beauty-clinic.
 *
 * Generates ~10,000 appointments that together cover EVERY financial
 * combination the app supports, so the operator can verify that all flows are
 * wired together:
 *   - patients (مراجع) with and without a referrer (معرف)
 *   - every referrer type: staff (کارمند), external/laser (کمیسیون‌گیرنده),
 *     and another patient (مراجعِ معرف → اعتبار کیف پول)
 *   - several patient tiers (سطح‌بندی)
 *   - services with and without a deposit (با/بدون بیعانه)
 *   - payments with and without a discount (با/بدون تخفیف), both percentage
 *     and fixed
 *   - wallet (کیف پول): both crediting a patient-referrer and paying from a
 *     patient's own balance (deduction)
 *
 * The financial side-effects mirror the real server logic in
 * artifacts/api-server/src/routes/payments.ts:
 *   - staff / external referrers accrue a commission row per payment
 *   - patient referrers are credited to their wallet (account transaction)
 *   - wallet deductions create a negative account transaction
 *   - discount usage counts are incremented
 * Wallet balances are recomputed from the ledger at the end so every
 * patient's balance equals the sum of their transactions.
 *
 * Run (after `pnpm run build` has produced the bundle):
 *   cd artifacts/api-server && node scripts/seed-all.mjs
 */
import {
  db,
  patientsTable,
  staffTable,
  commissionRecipientsTable,
  servicesTable,
  discountsTable,
  appointmentsTable,
  paymentsTable,
  commissionsTable,
  patientAccountTransactionsTable,
} from "@workspace/db";
import { sql, eq } from "drizzle-orm";

const nowMs = Date.now();
const DAY_MS = 86_400_000;
const DAY = 86_400;
const ri = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const round = Math.round;

const N_APPTS = 10_000;
const N_PATIENTS = 1_000;
const N_BASE_REFERRERS = 150; // first patients that can be referred-by (no referrer themselves)

const TIERS = ["عادی", "نقره‌ای", "طلایی", "الماس"];

async function chunkedInsert<T extends Record<string, unknown>>(
  table: Parameters<typeof db.insert>[0],
  rows: T[],
  size = 500,
): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const res = await db.insert(table).values(chunk as never).returning({ id: sql<number>`id` });
    for (const r of res) ids.push(Number(r.id));
  }
  return ids;
}

async function wipe() {
  // child → parent; users table is intentionally left untouched
  await db.delete(patientAccountTransactionsTable);
  await db.delete(commissionsTable);
  await db.delete(paymentsTable);
  await db.delete(appointmentsTable);
  await db.delete(patientsTable);
  await db.delete(servicesTable);
  await db.delete(discountsTable);
  await db.delete(commissionRecipientsTable);
  await db.delete(staffTable);
}

async function main() {
  // The dev API server keeps the same SQLite file open. Wait for its brief
  // locks instead of failing immediately, and use WAL for better concurrency.
  await db.run(sql`PRAGMA busy_timeout = 60000`);
  try { await db.run(sql`PRAGMA journal_mode = WAL`); } catch { /* ignore */ }

  await wipe();

  // ── 1) Staff (also act as commission recipients of type "staff") ──────────
  const staffRows = [
    { name: "دکتر سارا یاری", role: "پزشک", phone: "09120000001" },
    { name: "دکتر رضا محمدی", role: "پزشک", phone: "09120000002" },
    { name: "مهسا کریمی", role: "پرستار", phone: "09120000003" },
    { name: "نگار احمدی", role: "پرستار", phone: "09120000004" },
    { name: "الهام رستمی", role: "پذیرش", phone: "09120000005" },
  ];
  const staffIds = await chunkedInsert(staffTable, staffRows);
  const doctorIds = [staffIds[0], staffIds[1]];

  // ── 2) External / laser commission recipients ─────────────────────────────
  const recipientRows = [
    { name: "کلینیک لیزر آرمان", phone: "02100000001", description: "همکار معرف" },
    { name: "سالن زیبایی رز", phone: "02100000002", description: "همکار معرف" },
    { name: "مطب دکتر همکار", phone: "02100000003", description: "همکار معرف" },
    { name: "اینفلوئنسر اینستاگرام", phone: "02100000004", description: "تبلیغات" },
    { name: "مرکز پوست و مو نیکان", phone: "02100000005", description: "همکار معرف" },
  ];
  const recipientIds = await chunkedInsert(commissionRecipientsTable, recipientRows);

  // ── 3) Services: mix of total and per_unit pricing ────────────────────────
  const serviceRows = [
    { name: "بوتاکس", category: "تزریقات", price: 4_500_000, doctorFee: 1_500_000, materialCost: 800_000, priceMode: "total", unitLabel: null as string | null },
    { name: "ژل لب", category: "تزریقات", price: 6_000_000, doctorFee: 2_000_000, materialCost: 1_500_000, priceMode: "per_unit", unitLabel: "سی‌سی" },
    { name: "مزوتراپی مو", category: "پوست و مو", price: 1_200_000, doctorFee: 400_000, materialCost: 200_000, priceMode: "per_unit", unitLabel: "جلسه" },
    { name: "پاکسازی پوست", category: "پوست", price: 1_500_000, doctorFee: 300_000, materialCost: 250_000, priceMode: "total", unitLabel: null },
    { name: "لیزر موهای زائد", category: "لیزر", price: 800_000, doctorFee: 150_000, materialCost: 100_000, priceMode: "per_unit", unitLabel: "ناحیه" },
    { name: "فیلر گونه", category: "تزریقات", price: 5_500_000, doctorFee: 1_800_000, materialCost: 1_200_000, priceMode: "per_unit", unitLabel: "سرنگ" },
    { name: "پلاسما (PRP)", category: "پوست و مو", price: 2_800_000, doctorFee: 700_000, materialCost: 400_000, priceMode: "total", unitLabel: null },
    { name: "هایفوتراپی", category: "لیفت", price: 9_000_000, doctorFee: 3_000_000, materialCost: 1_500_000, priceMode: "total", unitLabel: null },
  ];
  const serviceIds = await chunkedInsert(
    servicesTable,
    serviceRows.map((s, i) => ({
      serviceCode: `SVC-${String(i + 1).padStart(3, "0")}`,
      name: s.name,
      category: s.category,
      price: s.price,
      doctorFee: s.doctorFee,
      materialCost: s.materialCost,
      otherCost: 0,
      unitCount: 1,
      unitLabel: s.unitLabel,
      priceMode: s.priceMode,
      doctorFeeMode: s.priceMode,
      materialCostMode: s.priceMode,
      otherCostMode: "total",
      isActive: true,
    })),
  );
  const services = serviceRows.map((s, i) => ({ id: serviceIds[i], ...s }));

  // ── 4) Discounts: percentage + fixed ──────────────────────────────────────
  const discountRows = [
    { name: "تخفیف نوروزی", code: "NOWRUZ15", type: "percentage", value: 15, description: "تخفیف مناسبتی نوروز" },
    { name: "تخفیف عضویت ویژه", code: "VIP10", type: "percentage", value: 10, description: "تخفیف اعضای ویژه" },
    { name: "تخفیف نقدی", code: "CASH500", type: "fixed", value: 500_000, description: "تخفیف پرداخت نقدی" },
    { name: "هدیه مناسبتی", code: "GIFT1M", type: "fixed", value: 1_000_000, description: "هدیه تولد" },
  ];
  const discountIds = await chunkedInsert(
    discountsTable,
    discountRows.map((d) => ({
      name: d.name,
      code: d.code,
      type: d.type,
      value: d.value,
      isActive: true,
      description: d.description,
      createdAt: Math.floor(nowMs / 1000) - 300 * DAY,
    })),
  );
  const discounts = discountRows.map((d, i) => ({ id: discountIds[i], ...d }));
  const pctDiscounts = discounts.filter((d) => d.type === "percentage");
  const fixedDiscounts = discounts.filter((d) => d.type === "fixed");

  // ── 5) Patients: cover every referrer × tier × funded combination ─────────
  const FIRST = ["مریم", "زهرا", "فاطمه", "علی", "محمد", "نگین", "سارا", "حسین", "رضا", "نازنین", "پریسا", "امیر", "سینا", "یاسمن", "کیمیا", "آرش", "بهار", "شیما", "مهدی", "الناز"];
  const LAST = ["محمدی", "حسینی", "رضایی", "کریمی", "موسوی", "احمدی", "صادقی", "جعفری", "رستمی", "نوری", "کاظمی", "اکبری", "قاسمی", "بهرامی", "سلطانی"];
  const patientName = (i: number) => `${pick(FIRST)} ${LAST[i % LAST.length]}`;

  type RefCfg = { type: "none" | "staff" | "external" | "patient"; rate: number };
  function refConfig(i: number): RefCfg {
    switch (i % 10) {
      case 2: return { type: "staff", rate: 10 };
      case 9: return { type: "staff", rate: 15 };
      case 3: return { type: "staff", rate: 20 };
      case 4: return { type: "external", rate: 10 };
      case 5: return { type: "external", rate: 15 };
      case 6: return { type: "external", rate: 25 };
      case 7: return { type: "patient", rate: 10 };
      case 8: return { type: "patient", rate: 15 };
      default: return { type: "none", rate: 0 };
    }
  }

  const patientInsert = Array.from({ length: N_PATIENTS }, (_, i) => ({
    fileNumber: `P-${String(i + 1).padStart(5, "0")}`,
    name: patientName(i),
    phone: `0913${String(1000000 + i).padStart(7, "0")}`,
    gender: i % 3 === 0 ? "male" : "female",
    tier: TIERS[i % TIERS.length],
    accountBalance: 0,
    createdAt: Math.floor(nowMs / 1000) - ri(30, 400) * DAY,
  }));
  const patientIds = await chunkedInsert(patientsTable, patientInsert);

  // Resolve referrer wiring now that ids exist, then persist it.
  const patients = patientInsert.map((p, i) => {
    const cfg = refConfig(i);
    let referrerType: string | null = null;
    let referrerId: number | null = null;
    let referrerRate: number | null = null;
    if (cfg.type === "staff") {
      referrerType = "staff";
      referrerId = pick(staffIds);
      referrerRate = cfg.rate;
    } else if (cfg.type === "external") {
      referrerType = "external";
      referrerId = pick(recipientIds);
      referrerRate = cfg.rate;
    } else if (cfg.type === "patient") {
      referrerType = "patient";
      referrerId = patientIds[ri(0, N_BASE_REFERRERS - 1)];
      referrerRate = cfg.rate;
    }
    const funded = i % 5 === 0;
    return {
      id: patientIds[i],
      name: p.name,
      tier: p.tier,
      referrerType,
      referrerId,
      referrerRate,
      funded,
    };
  });

  await db.transaction(async (tx) => {
    for (const p of patients) {
      if (!p.referrerType) continue;
      await tx
        .update(patientsTable)
        .set({ referrerType: p.referrerType, referrerId: p.referrerId, referrerRate: p.referrerRate })
        .where(eq(patientsTable.id, p.id));
    }
  });

  // Wallet ledger: opening credits for funded patients (شارژ اولیه کیف پول).
  const balance = new Map<number, number>();
  for (const p of patients) balance.set(p.id, 0);
  const openingTxns: { patientId: number; amount: number; type: string; description: string; paymentId: number | null; createdAt: number }[] = [];
  for (const p of patients) {
    if (!p.funded) continue;
    const amt = pick([5_000_000, 10_000_000, 20_000_000]);
    openingTxns.push({ patientId: p.id, amount: amt, type: "credit", description: "شارژ اولیه کیف پول", paymentId: null, createdAt: Math.floor(nowMs / 1000) - ri(20, 380) * DAY });
    balance.set(p.id, amt);
  }

  // ── 6) Appointments + payments + commissions + wallet transactions ────────
  const methods = ["cash", "card", "transfer"];
  const patientById = new Map(patients.map((p) => [p.id, p]));

  type ApptGen = {
    patientId: number;
    svc: (typeof services)[number];
    units: number;
    base: number;
    discountId: number | null;
    discountName: string | null;
    discountAmount: number;
    afterDiscount: number;
    bucket: "full" | "deposit" | "both";
    deposit: number;
    walletApply: number;
    schedMs: number;
    status: string;
    sessionNumber: number;
    appointmentCode: string;
  };

  const sessionMap = new Map<string, number>();
  const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const usedCodes = new Set<string>();
  const code = () => {
    let c: string;
    do { c = Array.from({ length: 5 }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join(""); } while (usedCodes.has(c));
    usedCodes.add(c);
    return c;
  };

  const gens: ApptGen[] = [];
  for (let n = 0; n < N_APPTS; n++) {
    const patient = patients[n % patients.length];
    const svc = pick(services);
    const isPU = svc.priceMode === "per_unit";
    const units = isPU ? ri(1, 8) : 1;
    const base = isPU ? svc.price * units : svc.price;

    // discount: none / percentage / fixed (cycled to guarantee coverage)
    let discountId: number | null = null;
    let discountName: string | null = null;
    let discountAmount = 0;
    const dchoice = n % 3;
    if (dchoice === 1 && pctDiscounts.length) {
      const d = pctDiscounts[n % pctDiscounts.length];
      discountId = d.id; discountName = d.name; discountAmount = round((base * d.value) / 100);
    } else if (dchoice === 2 && fixedDiscounts.length) {
      const d = fixedDiscounts[n % fixedDiscounts.length];
      discountId = d.id; discountName = d.name; discountAmount = Math.min(d.value, round(base * 0.4));
    }
    const afterDiscount = Math.max(0, base - discountAmount);

    // bucket: full / both (deposit + final) / deposit-only
    const r = Math.random();
    const bucket: ApptGen["bucket"] = r < 0.15 ? "deposit" : r < 0.5 ? "both" : "full";
    let deposit = 0;
    if (bucket !== "full") {
      deposit = Math.min(round(base * 0.3), Math.max(0, afterDiscount - 1));
      if (deposit <= 0) deposit = Math.min(round(base * 0.2), Math.max(0, afterDiscount));
    }

    // wallet deduction: funded patient pays part of the remaining due from balance
    let walletApply = 0;
    if (patient.funded && bucket !== "deposit" && Math.random() < 0.5) {
      const due = afterDiscount - deposit;
      const avail = balance.get(patient.id) ?? 0;
      walletApply = Math.min(round(due * 0.5), avail);
      if (walletApply < 0) walletApply = 0;
      if (walletApply > 0) balance.set(patient.id, avail - walletApply);
    }

    const completed = bucket !== "deposit";
    let schedMs: number;
    if (completed) schedMs = nowMs - ri(1, 270) * DAY_MS + ri(8, 18) * 3_600_000;
    else schedMs = (Math.random() < 0.5 ? nowMs + ri(1, 30) * DAY_MS : nowMs - ri(1, 60) * DAY_MS) + ri(8, 18) * 3_600_000;
    const status = completed ? "completed" : pick(["scheduled", "confirmed"]);

    const key = `${patient.id}:${svc.id}`;
    const sn = (sessionMap.get(key) ?? 0) + 1;
    sessionMap.set(key, sn);

    gens.push({
      patientId: patient.id, svc, units, base, discountId, discountName, discountAmount,
      afterDiscount, bucket, deposit, walletApply, schedMs, status, sessionNumber: sn, appointmentCode: code(),
    });
  }

  // Insert appointments, keep ids aligned with gens.
  const apptIds = await chunkedInsert(
    appointmentsTable,
    gens.map((a) => ({
      appointmentCode: a.appointmentCode,
      patientId: a.patientId,
      serviceId: a.svc.id,
      staffId: pick(doctorIds),
      scheduledAt: a.schedMs,
      status: a.status,
      price: a.afterDiscount,
      originalPrice: a.base,
      discountId: a.discountId,
      deposit: a.deposit > 0 ? a.deposit : null,
      sessionNumber: a.sessionNumber,
      unitsUsed: a.status === "completed" && a.svc.priceMode === "per_unit" ? a.units : null,
      createdAt: Math.floor(a.schedMs / 1000) - ri(0, 5) * DAY,
    })),
  );

  // Build payment rows + parallel meta so we can wire side-effects after insert.
  type PayMeta = {
    patientId: number;
    referrerType: string | null;
    referrerId: number | null;
    referrerRate: number | null;
    walletApply: number;       // wallet deduction taken on THIS payment
    referralCredit: number;    // wallet credit for a patient-referrer from THIS payment
    discountId: number | null;
    serviceName: string;
    schedSec: number;
  };
  const payRows: Record<string, unknown>[] = [];
  const payMeta: PayMeta[] = [];
  const discountUse = new Map<number, number>();

  for (let i = 0; i < gens.length; i++) {
    const a = gens[i];
    const apptId = apptIds[i];
    const patient = patientById.get(a.patientId)!;
    const schedSec = Math.floor(a.schedMs / 1000);
    const unitLabel = a.svc.priceMode === "per_unit" ? a.svc.unitLabel ?? null : null;
    const unitsUsed = a.svc.priceMode === "per_unit" ? a.units : null;

    const isStaffOrExternal = patient.referrerType === "staff" || patient.referrerType === "external";
    const isPatientRef = patient.referrerType === "patient";
    const refRate = patient.referrerRate ?? 0;

    const pushPayment = (
      originalAmount: number,
      amount: number,
      method: string,
      notes: string | null,
      paidAt: number,
      depositAmount: number,
      discountId: number | null,
      discountName: string | null,
      discountAmount: number,
      walletApply: number,
      isFinal: boolean,
    ) => {
      payRows.push({
        appointmentId: apptId,
        discountId,
        originalAmount,
        amount,
        method,
        paidAt,
        notes,
        patientName: patient.name,
        serviceName: a.svc.name,
        sessionNumber: a.sessionNumber,
        unitsUsed,
        unitLabel,
        discountName,
        discountAmount: discountAmount > 0 ? discountAmount : null,
        depositAmount: depositAmount > 0 ? depositAmount : null,
      });
      if (discountId) discountUse.set(discountId, (discountUse.get(discountId) ?? 0) + 1);
      // referral credit for a patient-referrer only happens on the completed/final money
      const referralCredit = isFinal && isPatientRef && refRate > 0 && amount > 0 ? round((amount * refRate) / 100) : 0;
      payMeta.push({
        patientId: a.patientId,
        referrerType: patient.referrerType,
        referrerId: patient.referrerId,
        referrerRate: patient.referrerRate,
        walletApply: isFinal ? walletApply : 0,
        referralCredit,
        discountId,
        serviceName: a.svc.name,
        schedSec,
      });
    };

    if (a.bucket === "deposit") {
      const depPaid = Math.min(Math.floor(nowMs / 1000), schedSec) - ri(0, 10) * DAY;
      pushPayment(a.deposit, a.deposit, "cash", "بیعانه", depPaid, a.deposit, null, null, 0, 0, false);
    } else if (a.bucket === "both") {
      const depPaid = schedSec - ri(2, 20) * DAY;
      pushPayment(a.deposit, a.deposit, "cash", "بیعانه", depPaid, a.deposit, null, null, 0, 0, false);
      const finalAmount = Math.max(0, a.afterDiscount - a.deposit - a.walletApply);
      pushPayment(a.base, finalAmount, pick(methods), null, schedSec, a.deposit, a.discountId, a.discountName, a.discountAmount, a.walletApply, true);
    } else {
      const finalAmount = Math.max(0, a.afterDiscount - a.walletApply);
      pushPayment(a.base, finalAmount, pick(methods), null, schedSec, 0, a.discountId, a.discountName, a.discountAmount, a.walletApply, true);
    }
    void isStaffOrExternal;
  }

  const paymentIds = await chunkedInsert(paymentsTable, payRows);

  // Wire commissions + wallet transactions to the freshly created payment ids.
  const commissionRows: Record<string, unknown>[] = [];
  const txnRows = [...openingTxns];
  for (let i = 0; i < payMeta.length; i++) {
    const m = payMeta[i];
    const payId = paymentIds[i];
    const amount = Number(payRows[i].amount);
    const refRate = m.referrerRate ?? 0;

    // staff / external commission accrues on EVERY payment with amount > 0
    if ((m.referrerType === "staff" || m.referrerType === "external") && m.referrerId && refRate > 0 && amount > 0) {
      const accrual = round((amount * refRate) / 100);
      if (accrual > 0) {
        const paid = Math.random() < 0.3;
        commissionRows.push({
          recipientType: m.referrerType,
          recipientId: m.referrerId,
          appointmentId: Number(payRows[i].appointmentId),
          paymentId: payId,
          description: "پورسانت معرفی بیمار",
          amount: accrual,
          rate: refRate,
          status: paid ? "paid" : "pending",
          isPaid: paid,
          paidAt: paid ? m.schedSec + ri(1, 20) * DAY : null,
          createdAt: m.schedSec,
        });
      }
    }

    // patient-referrer: credit the referrer patient's wallet (شارژ کیف پول)
    if (m.referralCredit > 0 && m.referrerId) {
      txnRows.push({
        patientId: m.referrerId,
        amount: m.referralCredit,
        type: "credit",
        description: `اعتبار معرفی — ${m.serviceName}`,
        paymentId: payId,
        createdAt: m.schedSec,
      });
      balance.set(m.referrerId, (balance.get(m.referrerId) ?? 0) + m.referralCredit);
    }

    // wallet deduction taken on this payment
    if (m.walletApply > 0) {
      txnRows.push({
        patientId: m.patientId,
        amount: -m.walletApply,
        type: "deduct",
        description: `استفاده در پرداخت — ${m.serviceName}`,
        paymentId: payId,
        createdAt: m.schedSec,
      });
      // balance was already decremented during generation
    }
  }

  await chunkedInsert(commissionsTable, commissionRows);
  await chunkedInsert(patientAccountTransactionsTable, txnRows);

  // ── 7) Reconcile discount usage counts and wallet balances ────────────────
  for (const [id, count] of discountUse) {
    await db.update(discountsTable).set({ usageCount: count }).where(eq(discountsTable.id, id));
  }

  // Recompute every patient balance from the ledger (balance == sum of txns).
  const sums = await db
    .select({ patientId: patientAccountTransactionsTable.patientId, total: sql<number>`sum(amount)` })
    .from(patientAccountTransactionsTable)
    .groupBy(patientAccountTransactionsTable.patientId);
  await db.transaction(async (tx) => {
    for (const s of sums) {
      await tx.update(patientsTable).set({ accountBalance: Number(s.total) }).where(eq(patientsTable.id, s.patientId));
    }
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  const byBucket = gens.reduce<Record<string, number>>((m, a) => ((m[a.bucket] = (m[a.bucket] ?? 0) + 1), m), {});
  const refDist = patients.reduce<Record<string, number>>((m, p) => ((m[p.referrerType ?? "none"] = (m[p.referrerType ?? "none"] ?? 0) + 1), m), {});
  const summary = {
    staff: staffIds.length,
    recipients: recipientIds.length,
    services: serviceIds.length,
    discounts: discountIds.length,
    patients: patientIds.length,
    referrerDistribution: refDist,
    appointments: apptIds.length,
    byBucket,
    payments: paymentIds.length,
    commissions: commissionRows.length,
    staffCommissions: commissionRows.filter((c) => c.recipientType === "staff").length,
    externalCommissions: commissionRows.filter((c) => c.recipientType === "external").length,
    walletTransactions: txnRows.length,
    fundedPatients: patients.filter((p) => p.funded).length,
    referralCredits: txnRows.filter((t) => t.type === "credit" && t.paymentId).length,
    walletDeductions: txnRows.filter((t) => t.type === "deduct").length,
    discountUsage: discounts.map((d) => ({ type: d.type, used: discountUse.get(d.id) ?? 0 })),
  };
  console.log(JSON.stringify(summary, null, 2));

  // Fail loudly if any required financial combination class is missing, so a
  // run is never silently incomplete (bucket/wallet selection is randomized).
  const checks: [string, boolean][] = [
    ["referrer: none", (refDist.none ?? 0) > 0],
    ["referrer: staff", (refDist.staff ?? 0) > 0],
    ["referrer: external", (refDist.external ?? 0) > 0],
    ["referrer: patient", (refDist.patient ?? 0) > 0],
    ["bucket: full (no deposit)", (byBucket.full ?? 0) > 0],
    ["bucket: both (with deposit)", (byBucket.both ?? 0) > 0],
    ["bucket: deposit-only", (byBucket.deposit ?? 0) > 0],
    ["staff commissions", summary.staffCommissions > 0],
    ["external commissions", summary.externalCommissions > 0],
    ["patient-referrer wallet credits", summary.referralCredits > 0],
    ["wallet deductions", summary.walletDeductions > 0],
    ["percentage discount used", discounts.some((d) => d.type === "percentage" && (discountUse.get(d.id) ?? 0) > 0)],
    ["fixed discount used", discounts.some((d) => d.type === "fixed" && (discountUse.get(d.id) ?? 0) > 0)],
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (missing.length) {
    console.error("SEED INCOMPLETE — missing combinations:", missing.join(", "));
    process.exit(1);
  }
  console.log("All required financial combinations present ✓");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
