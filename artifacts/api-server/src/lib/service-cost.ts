import { sql, type SQL } from "drizzle-orm";

// ── هزینهٔ خدمت در روز ارائهٔ خدمت ───────────────────────────────────────────
// هزینه (دستمزد پزشک + مواد + سایر) از «نسخهٔ قیمت» خدمت در service_price_history خوانده
// می‌شود که در روز نوبت معتبر بوده؛ پس تغییر قیمت یا هزینهٔ امروز، سود نوبت‌های گذشته را
// عوض نمی‌کند. اگر نسخه‌ای نباشد، مقادیر فعلی جدول services استفاده می‌شود.
// قرارداد نام‌ها در کوئری: a = appointments، s = services، v = نسخهٔ قیمت.

/** روز ارائهٔ خدمت (ثانیه): زمان نوبت؛ مقادیر قدیمیِ ثانیه‌ای هم پشتیبانی می‌شوند */
export const SERVICE_DATE: SQL = sql.raw(`(CASE WHEN a.scheduled_at < 100000000000 THEN a.scheduled_at ELSE a.scheduled_at / 1000 END)`);

/**
 * JOIN نسخهٔ معتبر در روز خدمت: آخرین نسخه با effective_from <= روز خدمت؛ اگر نوبت از
 * همهٔ نسخه‌ها قدیمی‌تر باشد، قدیمی‌ترین نسخه.
 */
export const PRICE_VERSION_JOIN: SQL = sql`LEFT JOIN service_price_history v ON v.id = coalesce(
  (SELECT h.id FROM service_price_history h
    WHERE h.service_id = a.service_id AND h.effective_from <= ${SERVICE_DATE}
    ORDER BY h.effective_from DESC, h.id DESC LIMIT 1),
  (SELECT h.id FROM service_price_history h
    WHERE h.service_id = a.service_id
    ORDER BY h.effective_from ASC, h.id ASC LIMIT 1)
)`;
const col = (name: string) => sql.raw(`coalesce(v.${name}, s.${name})`);

/** تعداد واحد مصرفی: واحد ثبت‌شدهٔ نوبت، وگرنه تعداد واحد خدمت در همان نسخه */
export function unitsSql(unitsOverride?: SQL): SQL {
  return unitsOverride
    ? sql`coalesce(${unitsOverride}, a.units_used, ${col("unit_count")}, 1)`
    : sql`coalesce(a.units_used, ${col("unit_count")}, 1)`;
}

/** یک جزء هزینه (دستمزد پزشک / مواد / سایر) با نسخهٔ معتبر در روز خدمت (خالی = صفر) */
export function costPartSql(part: "doctor" | "material" | "other", unitsOverride?: SQL): SQL {
  const [fee, mode] = part === "doctor"
    ? ["doctor_fee", "doctor_fee_mode"]
    : part === "material" ? ["material_cost", "material_cost_mode"] : ["other_cost", "other_cost_mode"];
  const units = unitsSql(unitsOverride);
  return sql`(CASE WHEN ${col(mode)} = 'per_unit' THEN coalesce(${col(fee)}, 0) * ${units} ELSE coalesce(${col(fee)}, 0) END)`;
}

/** هزینهٔ کل خدمتِ نوبت با نسخهٔ معتبر در روز خدمت (ستون‌های خالی = صفر) */
export function appointmentCostSql(unitsOverride?: SQL): SQL {
  return sql`(${costPartSql("doctor", unitsOverride)} + ${costPartSql("material", unitsOverride)} + ${costPartSql("other", unitsOverride)})`;
}
