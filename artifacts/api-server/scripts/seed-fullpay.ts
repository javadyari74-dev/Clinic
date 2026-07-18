import { db, patientsTable, appointmentsTable, paymentsTable, commissionsTable, discountsTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";

const nowMs = Date.now();
const nowSec = Math.floor(nowMs / 1000);
const DAY = 86400;
const ri = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const round = Math.round;

type Svc = { id: number; name: string; price: number; priceMode: string };
const SERVICES: Svc[] = [
  { id: 5, name: "Prp", price: 1690000, priceMode: "total" },
  { id: 6, name: "بوتاکس", price: 1590000, priceMode: "total" },
  { id: 3, name: "رجنفیل", price: 1990000, priceMode: "per_unit" },
  { id: 1, name: "رووفیل اولترا", price: 1990000, priceMode: "per_unit" },
  { id: 7, name: "پرلوکس کلاسیک", price: 7990000, priceMode: "total" },
];
const STAFF_ID = 1;
const DISCOUNT = { id: 1, value: 10 };
const N = 10000;

async function main() {
  const PATIENT_IDS = (await db.select({ id: patientsTable.id }).from(patientsTable)).map((r) => r.id);
  if (PATIENT_IDS.length === 0) throw new Error("no patients");

  const existing = await db.select({ c: appointmentsTable.appointmentCode }).from(appointmentsTable);
  const usedCodes = new Set<string>(existing.map((r) => r.c).filter((x): x is string => !!x));
  const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = () => {
    let c: string;
    do { c = Array.from({ length: 5 }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join(""); } while (usedCodes.has(c));
    usedCodes.add(c);
    return c;
  };

  const sessionMap = new Map<string, number>();
  const grp = await db
    .select({ p: appointmentsTable.patientId, s: appointmentsTable.serviceId, n: sql<number>`count(*)` })
    .from(appointmentsTable)
    .groupBy(appointmentsTable.patientId, appointmentsTable.serviceId);
  for (const g of grp) sessionMap.set(`${g.p}:${g.s}`, Number(g.n));

  function gen() {
    const patientId = pick(PATIENT_IDS);
    const svc = pick(SERVICES);
    const isPU = svc.priceMode === "per_unit";
    const units = isPU ? ri(1, 10) : 1;
    const base = isPU ? svc.price * units : svc.price;
    const schedMs = nowMs - ri(1, 180) * DAY * 1000 + ri(8, 18) * 3600 * 1000;
    const schedSec = Math.floor(schedMs / 1000);
    const useDiscount = Math.random() < 0.5;
    const useCommission = Math.random() < 0.5;
    const afterDiscount = useDiscount ? round(base * (1 - DISCOUNT.value / 100)) : base;
    const key = `${patientId}:${svc.id}`;
    const sn = (sessionMap.get(key) ?? 0) + 1;
    sessionMap.set(key, sn);
    const createdAtSec = schedSec - ri(0, 5) * DAY;
    return { patientId, svc, isPU, units, base, schedMs, schedSec, useDiscount, useCommission, afterDiscount, sn, createdAtSec, appointmentCode: code() } as any;
  }
  const appts: any[] = Array.from({ length: N }, gen);

  const apptIds: number[] = [];
  for (let i = 0; i < appts.length; i += 500) {
    const chunk = appts.slice(i, i + 500).map((a) => ({
      appointmentCode: a.appointmentCode,
      patientId: a.patientId,
      serviceId: a.svc.id,
      staffId: STAFF_ID,
      scheduledAt: a.schedMs,
      status: "completed",
      sessionNumber: a.sn,
      unitsUsed: a.isPU ? a.units : null,
      createdAt: a.createdAtSec,
    }));
    const rows = await db.insert(appointmentsTable).values(chunk).returning({ id: appointmentsTable.id });
    rows.forEach((r) => apptIds.push(r.id));
  }
  appts.forEach((a, i) => (a.id = apptIds[i]));

  const methods = ["cash", "card", "transfer"];
  const payments: any[] = [];
  const commissions: any[] = [];
  let discountUses = 0;
  for (const a of appts) {
    payments.push({ appointmentId: a.id, discountId: a.useDiscount ? DISCOUNT.id : null, originalAmount: a.base, amount: a.afterDiscount, method: pick(methods), notes: null, paidAt: a.schedSec });
    if (a.useDiscount) discountUses++;
    if (a.useCommission) {
      const rate = pick([10, 15, 20]);
      commissions.push({ recipientType: "staff", recipientId: STAFF_ID, appointmentId: a.id, amount: round(a.afterDiscount * rate / 100), rate, description: `کمیسیون ${a.svc.name} (${rate}٪)`, status: "pending", createdAt: a.schedSec });
    }
  }

  for (let i = 0; i < payments.length; i += 800) await db.insert(paymentsTable).values(payments.slice(i, i + 800));
  for (let i = 0; i < commissions.length; i += 800) await db.insert(commissionsTable).values(commissions.slice(i, i + 800));
  if (discountUses > 0) await db.update(discountsTable).set({ usageCount: sql`usage_count + ${discountUses}` }).where(eq(discountsTable.id, DISCOUNT.id));

  console.log(JSON.stringify({
    completedAppointments: appts.length,
    fullPayments: payments.length,
    discountedPayments: discountUses,
    commissions: commissions.length,
    perUnit: appts.filter((a) => a.isPU).length,
  }, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
