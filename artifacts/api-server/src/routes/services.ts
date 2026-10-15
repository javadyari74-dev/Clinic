import { Router, type IRouter } from "express";
import { eq, desc, isNotNull } from "drizzle-orm";
import { db, servicesTable, servicePriceHistoryTable } from "@workspace/db";
import {
  CreateServiceBody,
  UpdateServiceParams,
  UpdateServiceBody,
  DeleteServiceParams,
  GetServicePriceHistoryParams,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity";
import { tehranInstant } from "../lib/tehran-time";

const router: IRouter = Router();

async function generateServiceCode(): Promise<string> {
  const existing = await db
    .select({ code: servicesTable.serviceCode })
    .from(servicesTable)
    .where(isNotNull(servicesTable.serviceCode))
    .orderBy(desc(servicesTable.serviceCode));

  let nextNum = 1;
  if (existing.length > 0 && existing[0].code) {
    const match = existing[0].code.match(/SRV-(\d+)/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }
  return `SRV-${String(nextNum).padStart(4, "0")}`;
}

// ── تاریخچهٔ قیمت و هزینه ──────────────────────────────────────────────────────
// فیلدهایی که در قیمت‌گذاری/سود اثر دارند؛ تغییر هر کدام یک نسخهٔ جدید می‌سازد.
const PRICING_FIELDS = [
  "price", "priceMode", "unitCount",
  "doctorFee", "doctorFeeMode", "materialCost", "materialCostMode", "otherCost", "otherCostMode",
] as const;
type PricingField = (typeof PRICING_FIELDS)[number];
type Service = typeof servicesTable.$inferSelect;

function pricingSnapshot(s: Service) {
  return {
    price: s.price,
    priceMode: s.priceMode ?? "total",
    unitCount: s.unitCount ?? 1,
    doctorFee: s.doctorFee ?? 0,
    doctorFeeMode: s.doctorFeeMode ?? "total",
    materialCost: s.materialCost ?? 0,
    materialCostMode: s.materialCostMode ?? "total",
    otherCost: s.otherCost ?? 0,
    otherCostMode: s.otherCostMode ?? "total",
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function insertPriceVersion(
  tx: Tx | typeof db,
  service: Service,
  args: { effectiveFrom: number; changes: Array<{ field: PricingField; from: unknown; to: unknown }> | null; note?: string | null; changedBy?: string | null },
) {
  await tx.insert(servicePriceHistoryTable).values({
    serviceId: service.id,
    effectiveFrom: args.effectiveFrom,
    ...pricingSnapshot(service),
    changes: args.changes ? JSON.stringify(args.changes) : null,
    note: args.note?.trim() || null,
    changedBy: args.changedBy ?? null,
  });
}

/** «YYYY-MM-DD» میلادی (روز تهران) → ابتدای آن روز به ثانیه؛ نامعتبر = null */
function effectiveDateToSec(value: string | null | undefined): number | null | "invalid" {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return "invalid";
  return Math.floor(tehranInstant(Number(m[1]), Number(m[2]), Number(m[3])) / 1000);
}

router.get("/services", async (_req, res): Promise<void> => {
  const rows = await db.select().from(servicesTable).orderBy(servicesTable.name);
  res.json(rows);
});

router.post("/services", async (req, res): Promise<void> => {
  const parsed = CreateServiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const serviceCode = await generateServiceCode();
  const service = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(servicesTable)
      .values({ ...parsed.data, serviceCode })
      .returning();
    // نسخهٔ اول قیمت: برای همهٔ تاریخ‌ها معتبر تا تغییر بعدی
    await insertPriceVersion(tx, created, { effectiveFrom: 0, changes: null, note: "قیمت اولیه", changedBy: req.jwtUser?.username ?? null });
    return created;
  });
  await logActivity("create", "appointment", service.id, `خدمت جدید "${service.name}" (${serviceCode}) ثبت شد`);
  res.status(201).json(service);
});

router.put("/services/:id", async (req, res): Promise<void> => {
  const params = UpdateServiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateServiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { priceChangeNote, priceEffectiveDate, ...changes } = parsed.data;
  const effective = effectiveDateToSec(priceEffectiveDate);
  if (effective === "invalid") {
    res.status(400).json({ error: "تاریخ اعمال تغییر قیمت نامعتبر است" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const before = await tx.select().from(servicesTable).where(eq(servicesTable.id, params.data.id)).get();
    if (!before) return null;
    const [updated] = Object.keys(changes).length > 0
      ? await tx.update(servicesTable).set(changes).where(eq(servicesTable.id, params.data.id)).returning()
      : [before];
    // هر تغییر در قیمت یا هزینه‌ها یک نسخهٔ جدید در تاریخچه با جزئیات «از ← به»
    const oldSnap = pricingSnapshot(before);
    const newSnap = pricingSnapshot(updated);
    const diff = PRICING_FIELDS
      .filter((f) => oldSnap[f] !== newSnap[f])
      .map((f) => ({ field: f, from: oldSnap[f], to: newSnap[f] }));
    if (diff.length > 0) {
      await insertPriceVersion(tx, updated, {
        effectiveFrom: effective ?? Math.floor(Date.now() / 1000),
        changes: diff,
        note: priceChangeNote,
        changedBy: req.jwtUser?.username ?? null,
      });
    }
    return { service: updated, diff };
  });
  if (!result) {
    res.status(404).json({ error: "خدمت یافت نشد" });
    return;
  }
  if (result.diff.length > 0) {
    await logActivity("update", "service", result.service.id, `قیمت/هزینهٔ خدمت «${result.service.name}» تغییر کرد`);
  }
  res.json(result.service);
});

router.get("/services/:id/price-history", async (req, res): Promise<void> => {
  const params = GetServicePriceHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db.select().from(servicePriceHistoryTable)
    .where(eq(servicePriceHistoryTable.serviceId, params.data.id))
    .orderBy(desc(servicePriceHistoryTable.effectiveFrom), desc(servicePriceHistoryTable.id));
  res.json(rows.map((r) => {
    let changes: unknown[] = [];
    try { changes = r.changes ? JSON.parse(r.changes) : []; } catch { changes = []; }
    const { uuid: _uuid, ...rest } = r;
    return { ...rest, changes };
  }));
});

router.delete("/services/:id", async (req, res): Promise<void> => {
  const params = DeleteServiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const service = await db.transaction(async (tx) => {
    const [deleted] = await tx.delete(servicesTable).where(eq(servicesTable.id, params.data.id)).returning();
    if (deleted) await tx.delete(servicePriceHistoryTable).where(eq(servicePriceHistoryTable.serviceId, deleted.id));
    return deleted;
  });
  if (!service) {
    res.status(404).json({ error: "خدمت یافت نشد" });
    return;
  }
  res.sendStatus(204);
});

export default router;
