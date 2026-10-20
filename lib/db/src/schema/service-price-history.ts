import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { randomUUID } from "node:crypto";

// تاریخچهٔ قیمت و هزینهٔ خدمات: هر ردیف «نسخهٔ» کامل قیمت‌گذاری یک خدمت است که از
// effective_from (ثانیه) به بعد معتبر است. سود هر نوبت با نسخهٔ معتبر در روز ارائهٔ خدمت
// حساب می‌شود، پس تغییر قیمت امروز سود گذشته را عوض نمی‌کند.
// changes: JSON فهرست تغییرات نسبت به نسخهٔ قبل [{field, from, to}] (نسخهٔ اول: null)
export const servicePriceHistoryTable = sqliteTable("service_price_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  uuid: text("uuid").notNull().unique().$defaultFn(() => randomUUID()),
  serviceId: integer("service_id").notNull(),
  effectiveFrom: integer("effective_from").notNull(),
  price: integer("price").notNull(),
  priceMode: text("price_mode").notNull().default("total"),
  unitCount: integer("unit_count").notNull().default(1),
  doctorFee: integer("doctor_fee").notNull().default(0),
  doctorFeeMode: text("doctor_fee_mode").notNull().default("total"),
  materialCost: integer("material_cost").notNull().default(0),
  materialCostMode: text("material_cost_mode").notNull().default("total"),
  otherCost: integer("other_cost").notNull().default(0),
  otherCostMode: text("other_cost_mode").notNull().default("total"),
  changes: text("changes"),
  note: text("note"),
  changedBy: text("changed_by"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
}, (table) => [
  index("service_price_history_service_idx").on(table.serviceId, table.effectiveFrom),
]);

export type ServicePriceHistory = typeof servicePriceHistoryTable.$inferSelect;
