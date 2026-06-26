import { Router, type IRouter } from "express";
import { eq, desc, isNotNull } from "drizzle-orm";
import { db, servicesTable } from "@workspace/db";
import {
  CreateServiceBody,
  UpdateServiceParams,
  UpdateServiceBody,
  DeleteServiceParams,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity";

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
  const [service] = await db
    .insert(servicesTable)
    .values({ ...parsed.data, serviceCode })
    .returning();
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
  const [service] = await db
    .update(servicesTable)
    .set(parsed.data)
    .where(eq(servicesTable.id, params.data.id))
    .returning();
  if (!service) {
    res.status(404).json({ error: "خدمت یافت نشد" });
    return;
  }
  res.json(service);
});

router.delete("/services/:id", async (req, res): Promise<void> => {
  const params = DeleteServiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [service] = await db
    .delete(servicesTable)
    .where(eq(servicesTable.id, params.data.id))
    .returning();
  if (!service) {
    res.status(404).json({ error: "خدمت یافت نشد" });
    return;
  }
  res.sendStatus(204);
});

export default router;
