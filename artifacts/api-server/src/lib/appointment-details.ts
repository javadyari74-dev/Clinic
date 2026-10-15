import { and, eq, ne, sql } from "drizzle-orm";
import { appointmentsTable, patientsTable, servicesTable, staffTable } from "@workspace/db";
import { DEPOSIT_NOTE, PAID_TOTAL_SQL, type Tx } from "./payment-effects";
import { tehranInstant, tehranParts } from "./scheduled-sms";

// ستون‌های مشترک «نوبت با جزئیات» برای همهٔ مسیرهایی که نوبت برمی‌گردانند
// (فهرست نوبت‌ها، نوبت‌های یک مراجع، ...)؛ شامل جمع پرداخت‌ها و مانده.
const paidTotal = PAID_TOTAL_SQL(appointmentsTable.id);

export const appointmentWithDetails = {
  id: appointmentsTable.id,
  appointmentCode: appointmentsTable.appointmentCode,
  patientId: appointmentsTable.patientId,
  serviceId: appointmentsTable.serviceId,
  staffId: appointmentsTable.staffId,
  scheduledAt: appointmentsTable.scheduledAt,
  status: appointmentsTable.status,
  notes: appointmentsTable.notes,
  price: appointmentsTable.price,
  discountId: appointmentsTable.discountId,
  originalPrice: appointmentsTable.originalPrice,
  deposit: appointmentsTable.deposit,
  sessionNumber: appointmentsTable.sessionNumber,
  createdAt: appointmentsTable.createdAt,
  patientName: patientsTable.name,
  patientPhone: patientsTable.phone,
  patientFileNumber: patientsTable.fileNumber,
  patientTier: patientsTable.tier,
  serviceName: servicesTable.name,
  servicePrice: sql<number>`CASE WHEN ${servicesTable.priceMode} = 'per_unit' THEN ${servicesTable.price} * coalesce(${appointmentsTable.unitsUsed}, ${servicesTable.unitCount}, 1) ELSE ${servicesTable.price} END`,
  serviceCode: servicesTable.serviceCode,
  staffName: staffTable.name,
  unitsUsed: appointmentsTable.unitsUsed,
  priceMode: servicesTable.priceMode,
  unitPrice: servicesTable.price,
  unitLabel: servicesTable.unitLabel,
  serviceUnitCount: servicesTable.unitCount,
  paidTotal: sql<number>`${paidTotal}`.mapWith(Number),
  // مانده فقط وقتی معنا دارد که در صندوق پرداختی برای نوبت ثبت شده باشد؛ نوبتِ بی‌پرداخت
  // (مثلاً قیمت‌دار از داده‌های قدیمی) بدهی حساب نمی‌شود و همچنان در صندوق قابل پرداخت است
  remaining: sql<number | null>`CASE WHEN ${appointmentsTable.price} IS NULL OR NOT EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = ${appointmentsTable.id} AND COALESCE(p.notes, '') <> ${DEPOSIT_NOTE}) THEN NULL ELSE MAX(0, ${appointmentsTable.price} - ${paidTotal}) END`,
  hasCheckoutPayment: sql<boolean>`EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = ${appointmentsTable.id} AND COALESCE(p.notes, '') <> ${DEPOSIT_NOTE})`.mapWith((v) => Boolean(Number(v))),
};

/** زمان نوبت همیشه میلی‌ثانیه ذخیره می‌شود؛ مقدار ثانیه‌ای (کمتر از ۱e11) تبدیل می‌شود */
export function normalizeScheduledAt(ts: number): number;
export function normalizeScheduledAt(ts: number | undefined): number | undefined;
export function normalizeScheduledAt(ts: number | undefined): number | undefined {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return ts;
  return ts > 0 && ts < 1e11 ? ts * 1000 : ts;
}

/** بازهٔ یک روز تهران (میلی‌ثانیه، to انحصاری) که لحظهٔ داده‌شده در آن است */
export function tehranDayRangeMs(ms: number): { start: number; end: number } {
  const p = tehranParts(ms);
  const start = tehranInstant(p.y, p.m, p.d);
  return { start, end: tehranInstant(p.y, p.m, p.d + 1) };
}

/** بازهٔ روز تهران برای تاریخ میلادی «YYYY-MM-DD» (میلی‌ثانیه) */
export function tehranDateRangeMs(date: string): { start: number; end: number } | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(date);
  if (!m) {
    const d = new Date(date);
    return Number.isNaN(d.getTime()) ? null : tehranDayRangeMs(d.getTime());
  }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return { start: tehranInstant(y, mo, d), end: tehranInstant(y, mo, d + 1) };
}

/** تاریخ میلادیِ امروز به وقت تهران «YYYY-MM-DD» */
export function tehranTodayIso(nowMs = Date.now()): string {
  const p = tehranParts(nowMs);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/**
 * شمارهٔ جلسهٔ بعدی برای (مراجع، خدمت): بیشترین شمارهٔ جلسهٔ نوبت‌های لغونشده + ۱
 * (نه count+1 که با حذف/لغو تکراری می‌شد). excludeId برای ویرایش همان نوبت است.
 */
export async function nextSessionNumber(executor: Tx, patientId: number, serviceId: number, excludeId?: number): Promise<number> {
  const conds = [
    eq(appointmentsTable.patientId, patientId),
    eq(appointmentsTable.serviceId, serviceId),
    ne(appointmentsTable.status, "cancelled"),
  ];
  if (excludeId) conds.push(ne(appointmentsTable.id, excludeId));
  const [row] = await executor
    .select({ max: sql<number | null>`MAX(${appointmentsTable.sessionNumber})` })
    .from(appointmentsTable)
    .where(and(...conds));
  return Number(row?.max ?? 0) + 1;
}

export const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  scheduled: "رزرو شده",
  confirmed: "تایید شده",
  arrived: "حاضر شده",
  in_progress: "در حال انجام",
  completed: "تکمیل شده",
  cancelled: "لغو شده",
  no_show: "غیبت",
};

export const appointmentStatusLabel = (s: string) => APPOINTMENT_STATUS_LABELS[s] ?? s;
