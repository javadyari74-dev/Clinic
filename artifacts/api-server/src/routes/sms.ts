import { Router, type IRouter } from "express";
import { desc, sql, inArray } from "drizzle-orm";
import { db, smsLogTable, patientsTable } from "@workspace/db";
import {
  UpdateSmsSettingsBody,
  UpdateSmsTemplatesBody,
  SendManualSmsBody,
  ListSmsLogsQueryParams,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity";
import {
  SMS_SETTING_KEYS,
  SMS_TEMPLATE_KEYS,
  DEFAULT_TEMPLATES,
  type SmsTemplateName,
  getSmsSettings,
  getSmsTemplates,
  setAppSetting,
  getPanelCredit,
  sendSms,
  renderTemplate,
} from "../lib/sms";
import { getUpcomingBirthdays } from "../lib/birthdays";

const router: IRouter = Router();

// ── تنظیمات پنل ──────────────────────────────────────────────────────────────

router.get("/sms/settings", async (_req, res): Promise<void> => {
  const s = await getSmsSettings();
  // رمز عبور هرگز به کلاینت برنمی‌گردد؛ فقط وضعیت «تنظیم شده یا نه»
  res.json({
    username: s.username,
    from: s.from,
    hasPassword: s.password.length > 0,
    enabledAppointment: s.enabledAppointment,
    enabledPayment: s.enabledPayment,
    enabledCommission: s.enabledCommission,
  });
});

router.put("/sms/settings", async (req, res): Promise<void> => {
  const parsed = UpdateSmsSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;
  if (b.username !== undefined) await setAppSetting(SMS_SETTING_KEYS.username, b.username.trim());
  // رمز خالی یعنی «بدون تغییر»
  if (b.password !== undefined && b.password !== "") await setAppSetting(SMS_SETTING_KEYS.password, b.password);
  if (b.from !== undefined) await setAppSetting(SMS_SETTING_KEYS.from, b.from.trim());
  if (b.enabledAppointment !== undefined) await setAppSetting(SMS_SETTING_KEYS.enabledAppointment, String(b.enabledAppointment));
  if (b.enabledPayment !== undefined) await setAppSetting(SMS_SETTING_KEYS.enabledPayment, String(b.enabledPayment));
  if (b.enabledCommission !== undefined) await setAppSetting(SMS_SETTING_KEYS.enabledCommission, String(b.enabledCommission));

  await logActivity("update", "settings", 0, "تنظیمات پنل پیامکی به‌روزرسانی شد");

  const s = await getSmsSettings();
  res.json({
    username: s.username,
    from: s.from,
    hasPassword: s.password.length > 0,
    enabledAppointment: s.enabledAppointment,
    enabledPayment: s.enabledPayment,
    enabledCommission: s.enabledCommission,
  });
});

// ── قالب‌های پیامک ────────────────────────────────────────────────────────────

router.get("/sms/templates", async (_req, res): Promise<void> => {
  const templates = await getSmsTemplates();
  res.json({ ...templates, defaults: DEFAULT_TEMPLATES });
});

router.put("/sms/templates", async (req, res): Promise<void> => {
  const parsed = UpdateSmsTemplatesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  for (const name of Object.keys(SMS_TEMPLATE_KEYS) as SmsTemplateName[]) {
    const value = parsed.data[name];
    if (value !== undefined) {
      await setAppSetting(SMS_TEMPLATE_KEYS[name], value);
    }
  }
  await logActivity("update", "settings", 0, "قالب‌های پیامک به‌روزرسانی شد");
  const templates = await getSmsTemplates();
  res.json({ ...templates, defaults: DEFAULT_TEMPLATES });
});

// ── اعتبار پنل (تست اتصال) ────────────────────────────────────────────────────

router.get("/sms/credit", async (_req, res): Promise<void> => {
  const result = await getPanelCredit();
  res.json(result);
});

// ── ارسال دستی / تولد ─────────────────────────────────────────────────────────

router.post("/sms/send", async (req, res): Promise<void> => {
  const parsed = SendManualSmsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { message, patientIds, birthdayDays } = parsed.data;
  if (!message.trim()) {
    res.status(400).json({ error: "متن پیام خالی است" });
    return;
  }

  const eventType = parsed.data.eventType === "birthday" ? "birthday" as const : "manual" as const;

  // گیرندگان: یا از روی شناسه بیماران، یا بیماران دارای تولد در N روز آینده
  let recipients: { id: number; name: string; phone: string }[] = [];
  if (birthdayDays !== undefined) {
    const upcoming = await getUpcomingBirthdays(Math.min(Math.max(birthdayDays, 0), 90));
    recipients = upcoming.map((b) => ({ id: b.patientId, name: b.name, phone: b.phone }));
  } else if (patientIds && patientIds.length > 0) {
    const rows = await db
      .select({ id: patientsTable.id, name: patientsTable.name, phone: patientsTable.phone })
      .from(patientsTable)
      .where(inArray(patientsTable.id, patientIds));
    recipients = rows;
  }

  if (recipients.length === 0) {
    res.status(400).json({ error: "هیچ گیرنده‌ای انتخاب نشده است" });
    return;
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const r of recipients) {
    const text = renderTemplate(message, { "نام": r.name });
    const result = await sendSms({
      to: r.phone,
      text,
      eventType,
      recipientName: r.name,
      patientId: r.id,
    });
    if (result.ok) sent++;
    else {
      failed++;
      if (result.error && errors.length < 5 && !errors.includes(result.error)) errors.push(result.error);
    }
  }

  await logActivity("create", "sms", 0, `ارسال پیامک ${eventType === "birthday" ? "تبریک تولد" : "دستی"}: ${sent} موفق، ${failed} ناموفق`);
  res.json({ total: recipients.length, sent, failed, errors });
});

// ── تاریخچه ارسال ─────────────────────────────────────────────────────────────

router.get("/sms/logs", async (req, res): Promise<void> => {
  const query = ListSmsLogsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const page = Math.max(query.data.page ?? 1, 1);
  const limit = Math.min(Math.max(query.data.limit ?? 50, 1), 200);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(smsLogTable)
      .orderBy(desc(smsLogTable.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: sql<number>`count(*)` }).from(smsLogTable),
  ]);

  res.json({ data: rows, total });
});

export default router;
