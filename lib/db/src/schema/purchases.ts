import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { randomUUID } from "node:crypto";

// خریدهای مطب (مواد و محصولات): نوع محصول (مثلاً فیلر)، خود محصول (مثلاً فیلر رووفیل)،
// تاریخ و مبلغ خرید، و وضعیت تسویه با تأمین‌کننده.
// purchase_date و settled_at به ثانیه (مثل هزینه‌ها)؛ price = مبلغ کل خرید (تومان).
export const purchasesTable = sqliteTable("purchases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  uuid: text("uuid").notNull().unique().$defaultFn(() => randomUUID()),
  productType: text("product_type").notNull(),
  productName: text("product_name").notNull(),
  supplier: text("supplier"),
  quantity: integer("quantity").notNull().default(1),
  price: integer("price").notNull(),
  purchaseDate: integer("purchase_date").notNull(),
  isSettled: integer("is_settled", { mode: "boolean" }).notNull().default(false),
  settledAt: integer("settled_at"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
}, (table) => [
  index("purchases_date_idx").on(table.purchaseDate),
]);

export type Purchase = typeof purchasesTable.$inferSelect;

// محصولات ذخیره‌شده برای خرید (مثلاً نوع «فیلر»، محصول «لوناژل»)؛ در فرم خرید از
// همین فهرست انتخاب می‌شوند. فروشنده و قیمت پیش‌فرض اختیاری‌اند و فرم را پر می‌کنند.
export const purchaseProductsTable = sqliteTable("purchase_products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  uuid: text("uuid").notNull().unique().$defaultFn(() => randomUUID()),
  productType: text("product_type").notNull(),
  name: text("name").notNull(),
  defaultSupplier: text("default_supplier"),
  defaultPrice: integer("default_price"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export type PurchaseProduct = typeof purchaseProductsTable.$inferSelect;
