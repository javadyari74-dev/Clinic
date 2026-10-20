import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db, activityLogTable } from "@workspace/db";
import { ListActivityQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

// فید کوتاه داشبورد
router.get("/activity", async (req, res): Promise<void> => {
  const query = ListActivityQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { limit = 20 } = query.data;
  // این فید برای کاربران داشبورد (نه فقط مدیر) است؛ نام کاربری انجام‌دهنده فقط در
  // «تاریخچهٔ تغییرات» مدیر (/activity/log) نشان داده می‌شود.
  const rows = await db
    .select({
      id: activityLogTable.id,
      action: activityLogTable.action,
      entityType: activityLogTable.entityType,
      entityId: activityLogTable.entityId,
      description: activityLogTable.description,
      createdAt: activityLogTable.createdAt,
    })
    .from(activityLogTable)
    .orderBy(desc(activityLogTable.createdAt), desc(activityLogTable.id))
    .limit(Math.min(Math.max(1, limit), 200));
  res.json(rows);
});

const MAX_LIMIT = 500;

function intParam(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}
function strParam(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, 200) : undefined;
}

// GET /api/activity/log — صفحهٔ «تاریخچهٔ تغییرات» (فقط مدیر؛ قاعده در routes/index.ts)
// فیلترها: from/to (ثانیه)، entityType، action، q (متن در شرح یا نام کاربر)، limit/offset
router.get("/activity/log", async (req, res): Promise<void> => {
  const from = intParam(req.query.from);
  const to = intParam(req.query.to);
  const entityType = strParam(req.query.entityType);
  const action = strParam(req.query.action);
  const q = strParam(req.query.q);
  const limit = Math.min(Math.max(1, intParam(req.query.limit) ?? 50), MAX_LIMIT);
  const offset = Math.max(0, intParam(req.query.offset) ?? 0);

  const t = activityLogTable;
  const conds: SQL[] = [];
  if (from != null) conds.push(gte(t.createdAt, from));
  if (to != null) conds.push(lte(t.createdAt, to));
  if (entityType) conds.push(eq(t.entityType, entityType));
  if (action) conds.push(eq(t.action, action));
  // instr به‌جای LIKE تا % و _ در متن جست‌وجو معنای الگو نداشته باشند
  if (q) conds.push(sql`(instr(${t.description}, ${q}) > 0 OR instr(coalesce(${t.username}, ''), ${q}) > 0)`);
  const where = conds.length ? and(...conds) : undefined;

  const [items, totalRow, entityTypes, actions] = await Promise.all([
    db.select().from(t).where(where).orderBy(desc(t.createdAt), desc(t.id)).limit(limit).offset(offset),
    db.select({ n: sql<number>`count(*)` }).from(t).where(where).get(),
    db.selectDistinct({ v: t.entityType }).from(t),
    db.selectDistinct({ v: t.action }).from(t),
  ]);
  const total = Number(totalRow?.n ?? 0);
  res.json({
    items,
    total,
    hasMore: offset + items.length < total,
    entityTypes: entityTypes.map((r) => r.v).sort(),
    actions: actions.map((r) => r.v).sort(),
  });
});

export default router;
