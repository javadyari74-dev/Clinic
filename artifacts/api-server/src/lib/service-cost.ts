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

/**
 * ضریب مقدار فروخته‌شده برای هزینه‌های «کل»: هزینهٔ «کل» برای قیمت فهرستِ خدمت وارد شده (قیمت
 * کل، یا برای قیمت «هر واحد» = قیمت واحد × تعداد واحد پیش‌فرض خدمت). اگر مبلغ صورت‌حساب این نوبت
 * (بیشترین مبلغ اصلیِ پرداخت‌های تسویه، پیش از تخفیف) بیشتر باشد ــ ۱۱ سی‌سی از خدمتی که قیمتش برای ۱ سی‌سی
 * است، یا پکیج چند جلسه‌ای در یک نوبت ــ هزینهٔ «کل» هم به همان نسبت بیشتر است.
 * هزینه‌های «هر واحد» خودشان در تعداد واحد ضرب می‌شوند و این ضریب را نمی‌گیرند.
 * تخفیف و چانه‌زنی هزینه را کم نمی‌کند (حداقل ضریب ۱).
 * چرا «بیشترین»: پرداخت‌های بعدیِ همان نوبت (قسط/مانده) قیمت خالصِ پس از تخفیف یا فقط مانده را
 * به‌عنوان مبلغ اصلی دارند (کمتر از صورت‌حساب اول)، پس قسط‌ها ضریب را پایین نمی‌آورند و سودِ
 * ماه‌های بسته‌شده عوض نمی‌شود؛ اگر صورت‌حساب بعدی بزرگ‌تر باشد (واحد بیشتر)، همان ملاک می‌شود.
 */
export function billedFactorSql(): SQL {
  const referencePrice = sql`(CASE WHEN ${col("price_mode")} = 'per_unit'
    THEN coalesce(${col("price")}, 0) * max(coalesce(${col("unit_count")}, 1), 1) ELSE coalesce(${col("price")}, 0) END)`;
  return sql`max(1.0, coalesce(
    (SELECT max(bp.original_amount) FROM payments bp
      WHERE bp.appointment_id = a.id AND coalesce(bp.notes, '') <> 'بیعانه') * 1.0 / nullif(${referencePrice}, 0),
    1.0))`;
}

/** یک جزء هزینه (دستمزد پزشک / مواد / سایر) با نسخهٔ معتبر در روز خدمت (خالی = صفر) */
export function costPartSql(part: "doctor" | "material" | "other", unitsOverride?: SQL, billed = true): SQL {
  const [fee, mode] = part === "doctor"
    ? ["doctor_fee", "doctor_fee_mode"]
    : part === "material" ? ["material_cost", "material_cost_mode"] : ["other_cost", "other_cost_mode"];
  const units = unitsSql(unitsOverride);
  const total = billed
    ? sql`CAST(round(coalesce(${col(fee)}, 0) * ${billedFactorSql()}) AS integer)`
    : sql`coalesce(${col(fee)}, 0)`;
  return sql`(CASE WHEN ${col(mode)} = 'per_unit' THEN coalesce(${col(fee)}, 0) * ${units} ELSE ${total} END)`;
}

/** هزینهٔ کل خدمتِ نوبت با نسخهٔ معتبر در روز خدمت (ستون‌های خالی = صفر) */
export function appointmentCostSql(unitsOverride?: SQL, billed = true): SQL {
  return sql`(${costPartSql("doctor", unitsOverride, billed)} + ${costPartSql("material", unitsOverride, billed)} + ${costPartSql("other", unitsOverride, billed)})`;
}
