import { Router, type IRouter } from "express";
import { eq, desc, and, gte, lte, isNull, isNotNull, sql, type SQL } from "drizzle-orm";
import { db, surveysTable, patientsTable, servicesTable, staffTable } from "@workspace/db";
import {
  ListSurveysQueryParams,
  GetSurveyStatsQueryParams,
  ScoreSurveyParams,
  ScoreSurveyBody,
  DeleteSurveyParams,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity";

const router: IRouter = Router();

// ── نظرسنجی رضایت مراجعین ─────────────────────────────────────────────────────
// ردیف‌ها هنگام ارسال پیامک نظرسنجی (پس از ثبت پرداخت) ساخته می‌شوند؛ اینجا
// فقط فهرست، ثبت امتیاز دستی توسط منشی، حذف و آمار انجام می‌شود.

const surveyWithDetails = {
  id: surveysTable.id,
  patientId: surveysTable.patientId,
  appointmentId: surveysTable.appointmentId,
  paymentId: surveysTable.paymentId,
  serviceId: surveysTable.serviceId,
  staffId: surveysTable.staffId,
  sentAt: surveysTable.sentAt,
  smsStatus: surveysTable.smsStatus,
  score: surveysTable.score,
  comment: surveysTable.comment,
  scoredAt: surveysTable.scoredAt,
  createdAt: surveysTable.createdAt,
  patientName: patientsTable.name,
  patientPhone: patientsTable.phone,
  patientFileNumber: patientsTable.fileNumber,
  serviceName: servicesTable.name,
  staffName: staffTable.name,
};

function joinedSelect() {
  return db
    .select(surveyWithDetails)
    .from(surveysTable)
    .leftJoin(patientsTable, eq(surveysTable.patientId, patientsTable.id))
    .leftJoin(servicesTable, eq(surveysTable.serviceId, servicesTable.id))
    .leftJoin(staffTable, eq(surveysTable.staffId, staffTable.id));
}

async function selectSurvey(id: number) {
  const [row] = await joinedSelect().where(eq(surveysTable.id, id));
  return row;
}

router.get("/surveys", async (req, res): Promise<void> => {
  const query = ListSurveysQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { status, from, to } = query.data;
  const page = Math.max(query.data.page ?? 1, 1);
  const limit = Math.min(Math.max(query.data.limit ?? 50, 1), 200);

  const conditions: SQL[] = [];
  if (status === "pending") conditions.push(isNull(surveysTable.score));
  if (status === "scored") conditions.push(isNotNull(surveysTable.score));
  if (from !== undefined) conditions.push(gte(surveysTable.sentAt, from));
  if (to !== undefined) conditions.push(lte(surveysTable.sentAt, to));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalRows] = await Promise.all([
    joinedSelect()
      .where(whereClause)
      .orderBy(desc(surveysTable.sentAt), desc(surveysTable.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ count: sql<number>`count(*)` }).from(surveysTable).where(whereClause),
  ]);

  res.json({ data: rows, total: Number(totalRows[0].count) });
});

// آمار رضایت: کلی + به تفکیک خدمت و کارمند (فقط ردیف‌های امتیازدار در بازه)
router.get("/surveys/stats", async (req, res): Promise<void> => {
  const query = GetSurveyStatsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { from, to } = query.data;

  const rangeConditions: SQL[] = [];
  if (from !== undefined) rangeConditions.push(gte(surveysTable.sentAt, from));
  if (to !== undefined) rangeConditions.push(lte(surveysTable.sentAt, to));
  const rangeWhere = rangeConditions.length > 0 ? and(...rangeConditions) : undefined;
  const scoredWhere =
    rangeConditions.length > 0
      ? and(isNotNull(surveysTable.score), ...rangeConditions)
      : isNotNull(surveysTable.score);

  const [totals, scored, byService, byStaff] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(surveysTable).where(rangeWhere),
    db
      .select({
        count: sql<number>`count(*)`,
        avg: sql<number | null>`avg(${surveysTable.score})`,
      })
      .from(surveysTable)
      .where(scoredWhere),
    db
      .select({
        id: surveysTable.serviceId,
        name: servicesTable.name,
        count: sql<number>`count(*)`,
        avg: sql<number>`avg(${surveysTable.score})`,
      })
      .from(surveysTable)
      .leftJoin(servicesTable, eq(surveysTable.serviceId, servicesTable.id))
      .where(scoredWhere)
      .groupBy(surveysTable.serviceId, servicesTable.name),
    db
      .select({
        id: surveysTable.staffId,
        name: staffTable.name,
        count: sql<number>`count(*)`,
        avg: sql<number>`avg(${surveysTable.score})`,
      })
      .from(surveysTable)
      .leftJoin(staffTable, eq(surveysTable.staffId, staffTable.id))
      .where(scoredWhere)
      .groupBy(surveysTable.staffId, staffTable.name),
  ]);

  const toGroup = (r: { id: number | null; name: string | null; count: number; avg: number }) => ({
    id: r.id,
    // مرجع حذف‌شده یا نامعلوم — با برچسب «نامشخص» گزارش می‌شود
    name: r.name ?? "نامشخص",
    count: Number(r.count),
    avgScore: Number(r.avg),
  });

  const sortByAvg = (a: { avgScore: number }, b: { avgScore: number }) => b.avgScore - a.avgScore;

  res.json({
    total: Number(totals[0].count),
    scoredCount: Number(scored[0].count),
    avgScore: scored[0].avg == null ? null : Number(scored[0].avg),
    byService: byService.map(toGroup).sort(sortByAvg),
    byStaff: byStaff.map(toGroup).sort(sortByAvg),
  });
});

// ثبت (یا اصلاح) امتیاز ۱ تا ۵ توسط منشی
router.put("/surveys/:id", async (req, res): Promise<void> => {
  const params = ScoreSurveyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = ScoreSurveyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "امتیاز باید عددی بین ۱ تا ۵ باشد" });
    return;
  }
  if (!Number.isInteger(parsed.data.score)) {
    res.status(400).json({ error: "امتیاز باید عددی بین ۱ تا ۵ باشد" });
    return;
  }
  const [updated] = await db
    .update(surveysTable)
    .set({
      score: parsed.data.score,
      comment: parsed.data.comment?.trim() ? parsed.data.comment.trim() : null,
      scoredAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(surveysTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "نظرسنجی یافت نشد" });
    return;
  }
  const detail = await selectSurvey(updated.id);
  await logActivity("update", "survey", updated.id, `امتیاز نظرسنجی «${detail?.patientName ?? ""}» ثبت شد: ${parsed.data.score} از ۵`);
  res.json(detail);
});

router.delete("/surveys/:id", async (req, res): Promise<void> => {
  const params = DeleteSurveyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(surveysTable)
    .where(eq(surveysTable.id, params.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "نظرسنجی یافت نشد" });
    return;
  }
  await logActivity("delete", "survey", deleted.id, "نظرسنجی حذف شد");
  res.status(204).send();
});

export default router;
