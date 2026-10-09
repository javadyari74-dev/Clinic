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

// اعضای باشگاه: هر مراجع با اولین پرداخت (یا یک‌جا برای مراجعینِ دارای پرداخت قبلی)
// خودکار عضو می‌شود. سطح (برنزی/نقره‌ای/طلایی/الماسی) بر اساس مجموع پرداخت ۱۲ ماه
// اخیر تعیین و این‌جا نگه داشته می‌شود تا ارتقا (برای پیامک) قابل تشخیص باشد.
// چون عضویت از روی پرداخت‌ها قابل بازسازی است، جزو فایل پشتیبان نیست.
export const loyaltyMembersTable = sqliteTable("loyalty_members", {
  patientId: integer("patient_id").primaryKey(),
  // bronze | silver | gold | diamond
  tier: text("tier").notNull().default("bronze"),
  joinedAt: integer("joined_at").notNull().default(0),
  tierUpdatedAt: integer("tier_updated_at").notNull().default(0),
  // پیامک خوش‌آمد فرستاده شده (یا عضوِ یک‌جا که پیامک نمی‌گیرد)
  welcomed: integer("welcomed", { mode: "boolean" }).notNull().default(false),
});

export type LoyaltyMember = typeof loyaltyMembersTable.$inferSelect;
