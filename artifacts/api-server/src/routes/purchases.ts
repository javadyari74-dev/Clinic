import { Router, type IRouter } from "express";
import { and, eq, ne, asc, desc } from "drizzle-orm";
import { db, purchasesTable, purchaseProductsTable } from "@workspace/db";
import {
  CreatePurchaseBody,
  UpdatePurchaseParams,
  UpdatePurchaseBody,
  DeletePurchaseParams,
  CreatePurchaseProductBody,
  UpdatePurchaseProductParams,
  UpdatePurchaseProductBody,
  DeletePurchaseProductParams,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity";

// ── خریدها ────────────────────────────────────────────────────────────────────
// خرید مواد و محصولات مطب با وضعیت تسویه با تأمین‌کننده. این بخش در سود و زیان
// شمرده نمی‌شود، چون هزینهٔ مواد هر خدمت از قبل در «هزینهٔ خدمات» حساب می‌شود.

const router: IRouter = Router();
const nowSec = () => Math.floor(Date.now() / 1000);

function validate(b: { productType?: string; productName?: string; price?: number; quantity?: number }): string | null {
  if (b.productType !== undefined && !b.productType.trim()) return "نوع محصول را وارد کنید";
  if (b.productName !== undefined && !b.productName.trim()) return "نام محصول را وارد کنید";
  if (b.price !== undefined && (!Number.isFinite(b.price) || b.price < 0)) return "مبلغ خرید نامعتبر است";
  if (b.quantity !== undefined && (!Number.isInteger(b.quantity) || b.quantity < 1)) return "تعداد باید حداقل ۱ باشد";
  return null;
}

// ── محصولات ذخیره‌شده (فهرست انتخاب در فرم خرید) ─────────────────────────────

function productValues(b: { productType: string; name: string; defaultSupplier?: string | null; defaultPrice?: number | null; notes?: string | null }) {
  return {
    productType: b.productType.trim(),
    name: b.name.trim(),
    defaultSupplier: b.defaultSupplier?.trim() || null,
    defaultPrice: b.defaultPrice && b.defaultPrice > 0 ? Math.round(b.defaultPrice) : null,
    notes: b.notes?.trim() || null,
  };
}

async function duplicateProduct(productType: string, name: string, exceptId?: number) {
  const row = await db.select({ id: purchaseProductsTable.id }).from(purchaseProductsTable)
    .where(and(
      eq(purchaseProductsTable.productType, productType),
      eq(purchaseProductsTable.name, name),
      exceptId ? ne(purchaseProductsTable.id, exceptId) : undefined,
    )).get();
  return !!row;
}

router.get("/purchases/products", async (_req, res): Promise<void> => {
  const rows = await db.select().from(purchaseProductsTable)
    .orderBy(asc(purchaseProductsTable.productType), asc(purchaseProductsTable.name));
  res.json(rows);
});

router.post("/purchases/products", async (req, res): Promise<void> => {
  const parsed = CreatePurchaseProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const v = productValues(parsed.data);
  if (!v.productType || !v.name) {
    res.status(400).json({ error: "نوع محصول و نام محصول را وارد کنید" });
    return;
  }
  if (await duplicateProduct(v.productType, v.name)) {
    res.status(409).json({ error: "این محصول قبلاً در فهرست ذخیره شده است" });
    return;
  }
  const [row] = await db.insert(purchaseProductsTable).values(v).returning();
  res.status(201).json(row);
});

router.put("/purchases/products/:id", async (req, res): Promise<void> => {
  const params = UpdatePurchaseProductParams.safeParse(req.params);
  const parsed = UpdatePurchaseProductBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: (params.error ?? parsed.error)?.message });
    return;
  }
  const v = productValues(parsed.data);
  if (!v.productType || !v.name) {
    res.status(400).json({ error: "نوع محصول و نام محصول را وارد کنید" });
    return;
  }
  if (await duplicateProduct(v.productType, v.name, params.data.id)) {
    res.status(409).json({ error: "این محصول قبلاً در فهرست ذخیره شده است" });
    return;
  }
  const [row] = await db.update(purchaseProductsTable).set(v).where(eq(purchaseProductsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "محصول یافت نشد" });
    return;
  }
  res.json(row);
});

// حذف از فهرست، خریدهای ثبت‌شده با این محصول را تغییر نمی‌دهد
router.delete("/purchases/products/:id", async (req, res): Promise<void> => {
  const params = DeletePurchaseProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(purchaseProductsTable).where(eq(purchaseProductsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "محصول یافت نشد" });
    return;
  }
  res.sendStatus(204);
});

router.get("/purchases", async (_req, res): Promise<void> => {
  const rows = await db.select().from(purchasesTable).orderBy(desc(purchasesTable.purchaseDate), desc(purchasesTable.id));
  res.json(rows);
});

router.post("/purchases", async (req, res): Promise<void> => {
  const parsed = CreatePurchaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;
  const error = validate(b);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  const [row] = await db.insert(purchasesTable).values({
    productType: b.productType.trim(),
    productName: b.productName.trim(),
    supplier: b.supplier?.trim() || null,
    quantity: b.quantity ?? 1,
    price: Math.round(b.price),
    purchaseDate: b.purchaseDate,
    isSettled: b.isSettled ?? false,
    settledAt: b.isSettled ? nowSec() : null,
    notes: b.notes?.trim() || null,
  }).returning();
  await logActivity("create", "purchase", row.id, `خرید «${row.productName}» به مبلغ ${row.price.toLocaleString()} تومان ثبت شد`);
  res.status(201).json(row);
});

router.put("/purchases/:id", async (req, res): Promise<void> => {
  const params = UpdatePurchaseParams.safeParse(req.params);
  const parsed = UpdatePurchaseBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: (params.error ?? parsed.error)?.message });
    return;
  }
  const b = parsed.data;
  const error = validate(b);
  if (error) {
    res.status(400).json({ error });
    return;
  }
  const existing = await db.select().from(purchasesTable).where(eq(purchasesTable.id, params.data.id)).get();
  if (!existing) {
    res.status(404).json({ error: "خرید یافت نشد" });
    return;
  }
  const changes: Partial<typeof purchasesTable.$inferInsert> = {};
  if (b.productType !== undefined) changes.productType = b.productType.trim();
  if (b.productName !== undefined) changes.productName = b.productName.trim();
  if (b.supplier !== undefined) changes.supplier = b.supplier?.trim() || null;
  if (b.quantity !== undefined) changes.quantity = b.quantity;
  if (b.price !== undefined) changes.price = Math.round(b.price);
  if (b.purchaseDate !== undefined) changes.purchaseDate = b.purchaseDate;
  if (b.notes !== undefined) changes.notes = b.notes?.trim() || null;
  // تاریخ تسویه وقتی ثبت می‌شود که وضعیت به «تسویه شده» تغییر کند
  if (b.isSettled !== undefined && b.isSettled !== existing.isSettled) {
    changes.isSettled = b.isSettled;
    changes.settledAt = b.isSettled ? nowSec() : null;
  }
  const [row] = Object.keys(changes).length > 0
    ? await db.update(purchasesTable).set(changes).where(eq(purchasesTable.id, existing.id)).returning()
    : [existing];
  if (changes.isSettled !== undefined) {
    await logActivity("update", "purchase", row.id, `خرید «${row.productName}» ${row.isSettled ? "تسویه شد" : "تسویه‌نشده علامت خورد"}`);
  }
  res.json(row);
});

router.delete("/purchases/:id", async (req, res): Promise<void> => {
  const params = DeletePurchaseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(purchasesTable).where(eq(purchasesTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "خرید یافت نشد" });
    return;
  }
  await logActivity("delete", "purchase", row.id, `خرید «${row.productName}» حذف شد`);
  res.sendStatus(204);
});

export default router;
