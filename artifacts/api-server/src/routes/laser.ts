import { Router } from "express";
import { eq, and, asc, desc, count, like, or } from "drizzle-orm";
import {
  db,
  laserClientsTable,
  laserServicesTable,
  laserAppointmentsTable,
  laserPaymentsTable,
  laserSettingsTable,
  usersTable,
} from "@workspace/db";
import { requireAdmin } from "../lib/auth";
import { tehranShamsi } from "../lib/tehran-time";

const router = Router();

// ─── Laser operator (for auto-fill of operator name) ──────────────────────────
router.get("/laser/operator", async (_req, res) => {
  const operators = await db
    .select({ username: usersTable.username })
    .from(usersTable)
    .where(and(eq(usersTable.role, "laser_operator"), eq(usersTable.isActive, true)))
    .orderBy(asc(usersTable.id))
    .all();
  res.json({ operatorName: operators[0]?.username ?? null });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generate next service code: KH-001 for female, AG-001 for male */
async function nextServiceCode(gender: string): Promise<string> {
  const prefix = gender === "female" ? "KH" : "AG";
  const all = await db.select({ code: laserServicesTable.code })
    .from(laserServicesTable)
    .where(eq(laserServicesTable.genderCategory, gender as "female" | "male"))
    .all();
  const usedNums = all
    .map(r => r.code)
    .filter((c): c is string => !!c && c.startsWith(prefix + "-"))
    .map(c => parseInt(c.split("-")[1], 10))
    .filter(n => !isNaN(n));
  const next = usedNums.length ? Math.max(...usedNums) + 1 : 1;
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

/** زمان نوبت ورودی (میلی‌ثانیه، رشتهٔ ISO یا Date) → Date معتبر؛ نامعتبر = null */
function parseScheduledAt(value: unknown): Date | null {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const d = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

const INVALID_DATE_MESSAGE = "تاریخ نوبت نامعتبر است";

/**
 * کد نوبت: YYYYMMDD(شمسی، روز تهران)-شمارهٔ پرونده-کد خدمت؛ اگر همان مراجع همان خدمت را
 * در همان روز دوباره رزرو کند، پسوند -2، -3، … می‌گیرد تا ستون یکتا خطا ندهد.
 */
async function buildAppointmentCode(scheduledAt: Date, fileNumber: string, serviceCode: string): Promise<string> {
  const [y, m, d] = tehranShamsi(scheduledAt.getTime());
  const dateStr = `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
  const baseCode = `${dateStr}-${fileNumber}-${serviceCode}`;
  const taken = new Set(
    (await db.select({ code: laserAppointmentsTable.appointmentCode }).from(laserAppointmentsTable)
      .where(or(eq(laserAppointmentsTable.appointmentCode, baseCode), like(laserAppointmentsTable.appointmentCode, `${baseCode}-%`)))
      .all()).map((r) => r.code),
  );
  if (!taken.has(baseCode)) return baseCode;
  for (let n = 2; ; n++) {
    const candidate = `${baseCode}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ─── Clients ────────────────────────────────────────────────────────────────

router.get("/laser/clients", async (_req, res) => {
  const rows = await db.select().from(laserClientsTable).orderBy(desc(laserClientsTable.createdAt)).all();
  res.json(rows);
});

router.get("/laser/clients/:id", async (req, res) => {
  const row = await db.select().from(laserClientsTable).where(eq(laserClientsTable.id, Number(req.params.id))).get();
  if (!row) { res.status(404).json({ message: "مراجع یافت نشد" }); return; }
  res.json(row);
});

router.post("/laser/clients", async (req, res) => {
  const { fileNumber, name, phone, gender, email, birthdate, skinType, hairColor, medicalHistory, notes } = req.body ?? {};
  if (!fileNumber || !name || !phone || !gender) {
    res.status(400).json({ message: "فیلدهای اجباری: شماره پرونده، نام، تماس، جنسیت" });
    return;
  }
  const existing = await db.select({ id: laserClientsTable.id }).from(laserClientsTable).where(eq(laserClientsTable.fileNumber, fileNumber)).get();
  if (existing) { res.status(409).json({ message: "این شماره پرونده قبلاً ثبت شده است" }); return; }
  const [row] = await db.insert(laserClientsTable).values({
    fileNumber, name, phone, gender, email: email || null,
    birthdate: birthdate || null, skinType: skinType || null,
    hairColor: hairColor || null, medicalHistory: medicalHistory || null, notes: notes || null,
  }).returning();
  res.status(201).json(row);
});

router.put("/laser/clients/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { fileNumber, name, phone, gender, email, birthdate, skinType, hairColor, medicalHistory, notes } = req.body ?? {};
  const existing = await db.select({ id: laserClientsTable.id }).from(laserClientsTable).where(eq(laserClientsTable.id, id)).get();
  if (!existing) { res.status(404).json({ message: "مراجع یافت نشد" }); return; }
  const [row] = await db.update(laserClientsTable).set({
    fileNumber, name, phone, gender,
    email: email || null, birthdate: birthdate || null,
    skinType: skinType || null, hairColor: hairColor || null,
    medicalHistory: medicalHistory || null, notes: notes || null,
  }).where(eq(laserClientsTable.id, id)).returning();
  res.json(row);
});

// حذف فقط برای مدیر (مثل ویرایش/حذف پرداخت‌های لیزر)
router.delete("/laser/clients/:id", requireAdmin, async (req, res) => {
  await db.delete(laserClientsTable).where(eq(laserClientsTable.id, Number(req.params.id)));
  res.status(204).end();
});

// ─── Services ────────────────────────────────────────────────────────────────

router.get("/laser/services", async (req, res) => {
  const { gender } = req.query;
  const rows = gender
    ? await db.select().from(laserServicesTable).where(eq(laserServicesTable.genderCategory, gender as "female" | "male")).orderBy(laserServicesTable.name).all()
    : await db.select().from(laserServicesTable).orderBy(laserServicesTable.genderCategory, laserServicesTable.name).all();
  res.json(rows);
});

router.post("/laser/services", async (req, res) => {
  const { name, genderCategory, price, commissionRate, description, isActive } = req.body ?? {};
  if (!name || !genderCategory || price == null) {
    res.status(400).json({ message: "نام، دسته‌بندی جنسیت، و قیمت الزامی است" });
    return;
  }
  const code = await nextServiceCode(genderCategory);
  const [row] = await db.insert(laserServicesTable).values({
    code, name, genderCategory, price: Number(price),
    commissionRate: Number(commissionRate ?? 0),
    description: description || null,
    isActive: isActive ?? true,
  }).returning();
  res.status(201).json(row);
});

router.put("/laser/services/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, genderCategory, price, commissionRate, description, isActive } = req.body ?? {};
  const existing = await db.select({ id: laserServicesTable.id }).from(laserServicesTable).where(eq(laserServicesTable.id, id)).get();
  if (!existing) { res.status(404).json({ message: "خدمت یافت نشد" }); return; }
  const updates: Partial<typeof laserServicesTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (genderCategory !== undefined) updates.genderCategory = genderCategory;
  if (price !== undefined) updates.price = Number(price);
  if (commissionRate !== undefined) updates.commissionRate = Number(commissionRate);
  if (description !== undefined) updates.description = description || null;
  if (isActive !== undefined) updates.isActive = isActive;
  const [row] = await db.update(laserServicesTable).set(updates).where(eq(laserServicesTable.id, id)).returning();
  res.json(row);
});

// حذف فقط برای مدیر (مثل ویرایش/حذف پرداخت‌های لیزر)
router.delete("/laser/services/:id", requireAdmin, async (req, res) => {
  await db.delete(laserServicesTable).where(eq(laserServicesTable.id, Number(req.params.id)));
  res.status(204).end();
});

// ─── Appointments ────────────────────────────────────────────────────────────

router.get("/laser/appointments", async (req, res) => {
  const { status } = req.query;
  const rows = status
    ? await db.select().from(laserAppointmentsTable).where(eq(laserAppointmentsTable.status, status as "completed" | "cancelled" | "scheduled")).orderBy(desc(laserAppointmentsTable.scheduledAt)).all()
    : await db.select().from(laserAppointmentsTable).orderBy(desc(laserAppointmentsTable.scheduledAt)).all();

  // Enrich with client and service info
  const enriched = await Promise.all(rows.map(async (appt) => {
    const client = await db.select({ name: laserClientsTable.name, fileNumber: laserClientsTable.fileNumber, gender: laserClientsTable.gender, phone: laserClientsTable.phone })
      .from(laserClientsTable).where(eq(laserClientsTable.id, appt.clientId)).get();
    const service = await db.select({ name: laserServicesTable.name, price: laserServicesTable.price, commissionRate: laserServicesTable.commissionRate })
      .from(laserServicesTable).where(eq(laserServicesTable.id, appt.serviceId)).get();
    return { ...appt, client, service };
  }));
  res.json(enriched);
});

router.post("/laser/appointments", async (req, res) => {
  const { clientId, serviceId, operatorName, scheduledAt, sessionNumber, price, notes } = req.body ?? {};
  if (!clientId || !serviceId || !scheduledAt) {
    res.status(400).json({ message: "مراجع، خدمت، و تاریخ نوبت الزامی است" });
    return;
  }
  const client = await db.select({ id: laserClientsTable.id, fileNumber: laserClientsTable.fileNumber })
    .from(laserClientsTable).where(eq(laserClientsTable.id, Number(clientId))).get();
  if (!client) { res.status(404).json({ message: "مراجع یافت نشد" }); return; }

  const service = await db.select({ id: laserServicesTable.id, code: laserServicesTable.code })
    .from(laserServicesTable).where(eq(laserServicesTable.id, Number(serviceId))).get();
  if (!service) { res.status(404).json({ message: "خدمت یافت نشد" }); return; }

  const scheduledDate = parseScheduledAt(scheduledAt);
  if (!scheduledDate) { res.status(400).json({ message: INVALID_DATE_MESSAGE }); return; }
  const svcCode = service.code ?? "SVC";

  // اگر درخواست هم‌زمانی همان کد را زودتر گرفت، با کد بعدی دوباره تلاش می‌شود
  const insertWithCode = async () => {
    const appointmentCode = await buildAppointmentCode(scheduledDate, client.fileNumber, svcCode);
    const [inserted] = await db.insert(laserAppointmentsTable).values({
      appointmentCode,
      clientId: Number(clientId), serviceId: Number(serviceId),
      operatorName: operatorName || null,
      scheduledAt: scheduledDate,
      sessionNumber: sessionNumber ? Number(sessionNumber) : null,
      price: price ? Number(price) : null,
      notes: notes || null,
    }).returning();
    return inserted;
  };
  let row: Awaited<ReturnType<typeof insertWithCode>> | undefined;
  for (let attempt = 0; !row; attempt++) {
    try {
      row = await insertWithCode();
    } catch (err) {
      const dup = err instanceof Error && /UNIQUE constraint failed: laser_appointments\.appointment_code/.test(`${err.message} ${(err as { cause?: Error }).cause?.message ?? ""}`);
      if (!dup || attempt >= 4) throw err;
    }
  }
  const enriched = await db.select().from(laserAppointmentsTable).where(eq(laserAppointmentsTable.id, row.id)).get();
  res.status(201).json(enriched);
});

router.put("/laser/appointments/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { clientId, serviceId, operatorName, scheduledAt, status, sessionNumber, price, notes } = req.body ?? {};
  const existing = await db.select({ id: laserAppointmentsTable.id }).from(laserAppointmentsTable).where(eq(laserAppointmentsTable.id, id)).get();
  if (!existing) { res.status(404).json({ message: "نوبت یافت نشد" }); return; }
  const updates: Partial<typeof laserAppointmentsTable.$inferInsert> = {};
  if (clientId !== undefined) updates.clientId = Number(clientId);
  if (serviceId !== undefined) updates.serviceId = Number(serviceId);
  if (operatorName !== undefined) updates.operatorName = operatorName || null;
  if (scheduledAt !== undefined) {
    const d = parseScheduledAt(scheduledAt);
    if (!d) { res.status(400).json({ message: INVALID_DATE_MESSAGE }); return; }
    updates.scheduledAt = d;
  }
  if (status !== undefined) updates.status = status;
  if (sessionNumber !== undefined) updates.sessionNumber = sessionNumber ? Number(sessionNumber) : null;
  if (price !== undefined) updates.price = price ? Number(price) : null;
  if (notes !== undefined) updates.notes = notes || null;
  const [row] = await db.update(laserAppointmentsTable).set(updates).where(eq(laserAppointmentsTable.id, id)).returning();
  res.json(row);
});

// حذف فقط برای مدیر (مثل ویرایش/حذف پرداخت‌های لیزر)
router.delete("/laser/appointments/:id", requireAdmin, async (req, res) => {
  await db.delete(laserAppointmentsTable).where(eq(laserAppointmentsTable.id, Number(req.params.id)));
  res.status(204).end();
});

// ─── Payments ─────────────────────────────────────────────────────────────────

router.get("/laser/payments", async (_req, res) => {
  const rows = await db.select().from(laserPaymentsTable).orderBy(desc(laserPaymentsTable.paidAt)).all();
  const enriched = await Promise.all(rows.map(async (pay) => {
    const appt = await db.select({
      id: laserAppointmentsTable.id, clientId: laserAppointmentsTable.clientId,
      serviceId: laserAppointmentsTable.serviceId, scheduledAt: laserAppointmentsTable.scheduledAt,
    }).from(laserAppointmentsTable).where(eq(laserAppointmentsTable.id, pay.appointmentId)).get();
    const client = appt ? await db.select({ name: laserClientsTable.name, fileNumber: laserClientsTable.fileNumber })
      .from(laserClientsTable).where(eq(laserClientsTable.id, appt.clientId)).get() : null;
    const service = appt ? await db.select({ name: laserServicesTable.name })
      .from(laserServicesTable).where(eq(laserServicesTable.id, appt.serviceId)).get() : null;
    return { ...pay, appointment: appt, client, service };
  }));
  res.json(enriched);
});

// Edit a payment record — admin only
router.put("/laser/payments/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.select().from(laserPaymentsTable).where(eq(laserPaymentsTable.id, id)).get();
  if (!existing) { res.status(404).json({ message: "پرداخت یافت نشد" }); return; }
  const { amount, method, operatorName, commissionAmount, notes, nextSessionDate, nextSessionNote } = req.body ?? {};
  const updates: Partial<typeof laserPaymentsTable.$inferInsert> = {};
  if (amount !== undefined) updates.amount = Number(amount);
  if (method !== undefined) updates.method = method || "cash";
  if (operatorName !== undefined) updates.operatorName = operatorName || null;
  if (commissionAmount !== undefined) updates.commissionAmount = Number(commissionAmount ?? 0);
  if (notes !== undefined) updates.notes = notes || null;
  if (nextSessionDate !== undefined) updates.nextSessionDate = nextSessionDate || null;
  if (nextSessionNote !== undefined) updates.nextSessionNote = nextSessionNote || null;
  const [row] = await db.update(laserPaymentsTable).set(updates).where(eq(laserPaymentsTable.id, id)).returning();
  res.json(row);
});

// Delete a payment record — admin only. Reverts the linked appointment to active.
router.delete("/laser/payments/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.select().from(laserPaymentsTable).where(eq(laserPaymentsTable.id, id)).get();
  if (!existing) { res.status(404).json({ message: "پرداخت یافت نشد" }); return; }
  await db.delete(laserPaymentsTable).where(eq(laserPaymentsTable.id, id));
  await db.update(laserAppointmentsTable).set({ status: "scheduled" }).where(eq(laserAppointmentsTable.id, existing.appointmentId));
  res.status(204).end();
});

router.post("/laser/payments", async (req, res) => {
  const { appointmentId, amount, method, operatorName, commissionAmount, notes, nextSessionDate, nextSessionNote } = req.body ?? {};
  if (!appointmentId || amount == null) {
    res.status(400).json({ message: "شناسه نوبت و مبلغ الزامی است" });
    return;
  }
  const appt = await db.select().from(laserAppointmentsTable).where(eq(laserAppointmentsTable.id, Number(appointmentId))).get();
  if (!appt) { res.status(404).json({ message: "نوبت یافت نشد" }); return; }
  if (appt.status === "completed") { res.status(400).json({ message: "این نوبت قبلاً پرداخت شده است" }); return; }

  const [payment] = await db.insert(laserPaymentsTable).values({
    appointmentId: Number(appointmentId),
    amount: Number(amount),
    method: method || "cash",
    operatorName: operatorName || null,
    commissionAmount: Number(commissionAmount ?? 0),
    notes: notes || null,
    nextSessionDate: nextSessionDate || null,
    nextSessionNote: nextSessionNote || null,
  }).returning();

  await db.update(laserAppointmentsTable).set({ status: "completed" }).where(eq(laserAppointmentsTable.id, Number(appointmentId)));

  res.status(201).json(payment);
});

// ─── Reminders ────────────────────────────────────────────────────────────────

router.get("/laser/reminders", async (_req, res) => {
  const rows = await db.select().from(laserPaymentsTable).all();
  const withDate = rows.filter(r => r.nextSessionDate);
  const enriched = await Promise.all(withDate.map(async (pay) => {
    const appt = await db.select({
      id: laserAppointmentsTable.id, clientId: laserAppointmentsTable.clientId,
      serviceId: laserAppointmentsTable.serviceId,
    }).from(laserAppointmentsTable).where(eq(laserAppointmentsTable.id, pay.appointmentId)).get();
    const client = appt ? await db.select({ name: laserClientsTable.name, fileNumber: laserClientsTable.fileNumber, phone: laserClientsTable.phone })
      .from(laserClientsTable).where(eq(laserClientsTable.id, appt.clientId)).get() : null;
    const service = appt ? await db.select({ name: laserServicesTable.name })
      .from(laserServicesTable).where(eq(laserServicesTable.id, appt.serviceId)).get() : null;
    return { ...pay, client, service };
  }));

  // Sort by proximity to today
  const today = new Date().toISOString().split("T")[0];
  enriched.sort((a, b) => {
    const da = Math.abs(new Date(a.nextSessionDate!).getTime() - new Date(today).getTime());
    const db2 = Math.abs(new Date(b.nextSessionDate!).getTime() - new Date(today).getTime());
    return da - db2;
  });

  res.json(enriched);
});

// ─── Settings ─────────────────────────────────────────────────────────────────

async function getSettings() {
  let row = await db.select().from(laserSettingsTable).where(eq(laserSettingsTable.id, 1)).get();
  if (!row) {
    [row] = await db.insert(laserSettingsTable).values({ id: 1, commissionRate: 0 }).returning();
  }
  return row;
}

router.get("/laser/settings", async (_req, res) => {
  res.json(await getSettings());
});

router.put("/laser/settings", requireAdmin, async (req, res) => {
  const { commissionRate } = req.body ?? {};
  if (commissionRate == null || isNaN(Number(commissionRate))) {
    res.status(400).json({ message: "نرخ کمیسیون الزامی است" }); return;
  }
  const rate = Math.max(0, Math.min(100, Number(commissionRate)));
  await getSettings();
  const [row] = await db.update(laserSettingsTable).set({ commissionRate: rate }).where(eq(laserSettingsTable.id, 1)).returning();
  res.json(row);
});

export default router;
