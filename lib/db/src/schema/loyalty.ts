import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { randomUUID } from "node:crypto";

// باشگاه مشتریان (امتیاز وفاداری): هر پرداخت بر اساس نرخ تنظیم‌شده امتیاز
// می‌سازد (earn)، هنگام پرداختِ بعدی می‌توان امتیاز را خرج کرد (redeem) و با حذف
// پرداخت، آثار امتیازی همان پرداخت برگردانده می‌شود (reverse). موجودی امتیاز هر
// مراجع = جمع deltaهای او؛ ستون جداگانه‌ای نگه نمی‌داریم تا هیچ‌وقت ناهماهنگ نشود.
// تنظیمات (فعال‌بودن، نرخ کسب، ارزش هر امتیاز، حداقل امتیاز برای استفاده) در
// app_settings ذخیره می‌شوند.
export const loyaltyTransactionsTable = sqliteTable("loyalty_transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  uuid: text("uuid").notNull().unique().$defaultFn(() => randomUUID()),
  patientId: integer("patient_id").notNull(),
  // پرداختی که این تراکنش امتیازی به آن گره خورده (برای برگرداندن هنگام حذف)
  paymentId: integer("payment_id"),
  // تغییر امتیاز: مثبت برای کسب، منفی برای خرج/برگردان
  delta: integer("delta").notNull(),
  // معادل تومانیِ این تراکنش (مبنای کسب یا ارزش خرج‌شده) — اسنپ‌شات برای گزارش
  amount: integer("amount").notNull().default(0),
  // earn | redeem | reverse
  type: text("type").notNull(),
  description: text("description"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
}, (table) => [
  index("loyalty_txns_patient_id_idx").on(table.patientId),
  index("loyalty_txns_payment_id_idx").on(table.paymentId),
]);

export type LoyaltyTransaction = typeof loyaltyTransactionsTable.$inferSelect;
export type InsertLoyaltyTransaction = typeof loyaltyTransactionsTable.$inferInsert;
