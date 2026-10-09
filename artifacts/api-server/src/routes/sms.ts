import { Router, type IRouter } from "express";
import { desc, sql, inArray, eq } from "drizzle-orm";
import { db, smsLogTable, patientsTable, smsSavedPatternsTable, loyaltyMembersTable } from "@workspace/db";
import { getWalletBalance, isLoyaltyTier, TIER_LABELS } from "../lib/loyalty";
import {
  UpdateSmsSettingsBody,
  UpdateSmsTemplatesBody,
  SendManualSmsBody,
  SendPatternSmsBody,
  CreateSavedSmsPatternBody,
  UpdateSavedSmsPatternBody,
  ListSmsLogsQueryParams,
} from "@workspace/api-zod";
import { logActivity } from "../lib/activity";
import { logger } from "../lib/logger";
import {
  SMS_SETTING_KEYS,
  SMS_TEMPLATE_KEYS,
  DEFAULT_TEMPLATES,
  type SmsTemplateName,
  getSmsSettings,
  getSmsTemplates,
  setAppSetting,
  clampSurveyThrottleDays,
  clampHour,
  APPOINTMENT_REMINDER_DEFAULT_HOUR,
  DAILY_AUTO_DEFAULT_HOUR,
  getPanelCredit,
  sendSms,
  renderTemplate,
  normalizePhone,
  toPersianDigits,
  formatToman,
} from "../lib/sms";
import { getUpcomingBirthdays } from "../lib/birthdays";
import { birthdaySmsKey, markScheduledSms, upcomingBirthdayShamsiYear } from "../lib/scheduled-sms";

const router: IRouter = Router();

// ── تنظیمات پنل ──────────────────────────────────────────────────────────────

function settingsResponse(s: Awaited<ReturnType<typeof getSmsSettings>>) {
  // رمز عبور هرگز به کلاینت برنمی‌گردد؛ فقط وضعیت «تنظیم شده یا نه»
  return {
    username: s.username,
    from: s.from,
    hasPassword: s.password.length > 0,
    enabledAppointment: s.enabledAppointment,
    enabledPayment: s.enabledPayment,
    enabledCommission: s.enabledCommission,
    enabledRecipientWelcome: s.enabledRecipientWelcome,
    enabledSurvey: s.enabledSurvey,
    surveyThrottleDays: s.surveyThrottleDays,
    sendMode: s.sendMode,
    bodyIdAppointment: s.bodyIdAppointment,
    bodyIdPayment: s.bodyIdPayment,
    bodyIdCommission: s.bodyIdCommission,
    bodyIdBirthday: s.bodyIdBirthday,
    bodyIdSurvey: s.bodyIdSurvey,
    bodyIdRecipientWelcome: s.bodyIdRecipientWelcome,
    enabledAppointmentReminder: s.enabledAppointmentReminder,
    enabledFollowupReminder: s.enabledFollowupReminder,
    enabledBirthdayAuto: s.enabledBirthdayAuto,
    appointmentReminderHour: s.appointmentReminderHour,
    dailyAutoHour: s.dailyAutoHour,
    bodyIdAppointmentReminder: s.bodyIdAppointmentReminder,
    bodyIdFollowupReminder: s.bodyIdFollowupReminder,
    enabledLoyaltyWelcome: s.enabledLoyaltyWelcome,
    enabledLoyaltyTierUp: s.enabledLoyaltyTierUp,
    enabledLoyaltyExpiry: s.enabledLoyaltyExpiry,
    enabledLoyaltyReferral: s.enabledLoyaltyReferral,
    bodyIdLoyaltyWelcome: s.bodyIdLoyaltyWelcome,
    bodyIdLoyaltyTierUp: s.bodyIdLoyaltyTierUp,
    bodyIdLoyaltyExpiry: s.bodyIdLoyaltyExpiry,
    bodyIdLoyaltyReferral: s.bodyIdLoyaltyReferral,
    bodyIdPaymentLoyalty: s.bodyIdPaymentLoyalty,
    bodyIdLoyaltyNotify: s.bodyIdLoyaltyNotify,
  };
}

router.get("/sms/settings", async (_req, res): Promise<void> => {
  const s = await getSmsSettings();
  res.json(settingsResponse(s));
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
  if (b.enabledRecipientWelcome !== undefined) await setAppSetting(SMS_SETTING_KEYS.enabledRecipientWelcome, String(b.enabledRecipientWelcome));
  if (b.enabledSurvey !== undefined) await setAppSetting(SMS_SETTING_KEYS.enabledSurvey, String(b.enabledSurvey));
  if (b.enabledAppointmentReminder !== undefined) await setAppSetting(SMS_SETTING_KEYS.enabledAppointmentReminder, String(b.enabledAppointmentReminder));
  if (b.enabledFollowupReminder !== undefined) await setAppSetting(SMS_SETTING_KEYS.enabledFollowupReminder, String(b.enabledFollowupReminder));
  if (b.enabledBirthdayAuto !== undefined) await setAppSetting(SMS_SETTING_KEYS.enabledBirthdayAuto, String(b.enabledBirthdayAuto));
  if (b.enabledLoyaltyWelcome !== undefined) await setAppSetting(SMS_SETTING_KEYS.enabledLoyaltyWelcome, String(b.enabledLoyaltyWelcome));
  if (b.enabledLoyaltyTierUp !== undefined) await setAppSetting(SMS_SETTING_KEYS.enabledLoyaltyTierUp, String(b.enabledLoyaltyTierUp));
  if (b.enabledLoyaltyExpiry !== undefined) await setAppSetting(SMS_SETTING_KEYS.enabledLoyaltyExpiry, String(b.enabledLoyaltyExpiry));
  if (b.enabledLoyaltyReferral !== undefined) await setAppSetting(SMS_SETTING_KEYS.enabledLoyaltyReferral, String(b.enabledLoyaltyReferral));
  // ساعت ارسال: عدد صحیح ۰ تا ۲۳
  if (b.appointmentReminderHour !== undefined) {
    await setAppSetting(SMS_SETTING_KEYS.appointmentReminderHour, String(clampHour(b.appointmentReminderHour, APPOINTMENT_REMINDER_DEFAULT_HOUR)));
  }
  if (b.dailyAutoHour !== undefined) {
    await setAppSetting(SMS_SETTING_KEYS.dailyAutoHour, String(clampHour(b.dailyAutoHour, DAILY_AUTO_DEFAULT_HOUR)));
  }
  // حداقل فاصله نظرسنجی: عدد صحیح ۰ تا ۳۶۵ روز
  if (b.surveyThrottleDays !== undefined) {
    await setAppSetting(SMS_SETTING_KEYS.surveyThrottleDays, String(clampSurveyThrottleDays(b.surveyThrottleDays)));
  }
  // کد پترن باید فقط رقم باشد (یا خالی برای پاک کردن)
  const bodyIdFields = [
    ["bodyIdAppointment", SMS_SETTING_KEYS.bodyIdAppointment],
    ["bodyIdPayment", SMS_SETTING_KEYS.bodyIdPayment],
    ["bodyIdCommission", SMS_SETTING_KEYS.bodyIdCommission],
    ["bodyIdBirthday", SMS_SETTING_KEYS.bodyIdBirthday],
    ["bodyIdSurvey", SMS_SETTING_KEYS.bodyIdSurvey],
    ["bodyIdRecipientWelcome", SMS_SETTING_KEYS.bodyIdRecipientWelcome],
    ["bodyIdAppointmentReminder", SMS_SETTING_KEYS.bodyIdAppointmentReminder],
    ["bodyIdFollowupReminder", SMS_SETTING_KEYS.bodyIdFollowupReminder],
    ["bodyIdLoyaltyWelcome", SMS_SETTING_KEYS.bodyIdLoyaltyWelcome],
    ["bodyIdLoyaltyTierUp", SMS_SETTING_KEYS.bodyIdLoyaltyTierUp],
    ["bodyIdLoyaltyExpiry", SMS_SETTING_KEYS.bodyIdLoyaltyExpiry],
    ["bodyIdLoyaltyReferral", SMS_SETTING_KEYS.bodyIdLoyaltyReferral],
    ["bodyIdPaymentLoyalty", SMS_SETTING_KEYS.bodyIdPaymentLoyalty],
    ["bodyIdLoyaltyNotify", SMS_SETTING_KEYS.bodyIdLoyaltyNotify],
  ] as const;
  for (const [field] of bodyIdFields) {
    const value = b[field];
    if (value !== undefined && value.trim() !== "" && !/^\d+$/.test(value.trim())) {
      res.status(400).json({ error: "کد پترن باید فقط شامل رقم باشد" });
      return;
    }
  }

  if (b.sendMode !== undefined) await setAppSetting(SMS_SETTING_KEYS.sendMode, b.sendMode);
  for (const [field, key] of bodyIdFields) {
    const value = b[field];
    if (value !== undefined) await setAppSetting(key, value.trim());
  }

  await logActivity("update", "settings", 0, "تنظیمات پنل پیامکی به‌روزرسانی شد");

  const s = await getSmsSettings();
  res.json(settingsResponse(s));
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
  const { message, patientIds, birthdayDays, loyaltyTiers } = parsed.data;
  if (!message.trim()) {
    res.status(400).json({ error: "متن پیام خالی است" });
    return;
  }

  const eventType =
    parsed.data.eventType === "birthday" ? "birthday" as const
    : loyaltyTiers !== undefined ? "loyalty_bulk" as const
    : "manual" as const;

  // گیرندگان: بیماران انتخابی، بیماران دارای تولد در N روز آینده، یا اعضای باشگاه
  // (loyaltyTiers: فهرست سطح‌ها؛ آرایهٔ خالی = همهٔ اعضا)
  let recipients: { id: number; name: string; phone: string }[] = [];
  if (loyaltyTiers !== undefined) {
    const tiers = loyaltyTiers.filter(isLoyaltyTier);
    const rows = await db
      .select({ id: patientsTable.id, name: patientsTable.name, phone: patientsTable.phone })
      .from(loyaltyMembersTable)
      .innerJoin(patientsTable, eq(patientsTable.id, loyaltyMembersTable.patientId))
      .where(tiers.length > 0 ? inArray(loyaltyMembersTable.tier, tiers) : undefined);
    recipients = rows;
  } else if (birthdayDays !== undefined) {
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

  // در حالت خدماتی (پترن)، پیامک تولد با پترن تولد ارسال می‌شود ({0}=نام).
  // ارسال دستی متن آزاد همیشه با متد عادی می‌رود (پترن از متن آزاد پشتیبانی نمی‌کند).
  const settings = await getSmsSettings();
  const usePattern = settings.sendMode === "pattern" && eventType === "birthday";

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  const birthdaySent: number[] = [];
  // متغیرهای باشگاه برای هر گیرنده: {اعتبار} (یا {امتیاز}) = موجودی کیف پول به تومان، {سطح}
  const usesLoyaltyVars = /\{\s*(امتیاز|اعتبار|سطح)\s*\}/.test(message);
  const memberTiers = new Map<number, string>();
  if (usesLoyaltyVars) {
    const rows = await db.select().from(loyaltyMembersTable)
      .where(inArray(loyaltyMembersTable.patientId, recipients.map((r) => r.id)));
    for (const m of rows) memberTiers.set(m.patientId, m.tier);
  }
  for (const r of recipients) {
    const tier = memberTiers.get(r.id);
    const text = renderTemplate(message, {
      "نام": r.name,
      ...(usesLoyaltyVars ? await (async () => {
        const wallet = formatToman(await getWalletBalance(db, r.id));
        return { "اعتبار": wallet, "امتیاز": wallet };
      })() : { "اعتبار": "", "امتیاز": "" }),
      "سطح": tier && isLoyaltyTier(tier) ? TIER_LABELS[tier] : "",
      // جای‌نگهدارهای پیامک‌های خودکار، در ارسال دستی خالی می‌شوند
      "هدیه_باشگاه": "",
      "باشگاه": "",
    });
    const result = await sendSms({
      to: r.phone,
      text,
      eventType,
      recipientName: r.name,
      patientId: r.id,
      pattern: usePattern ? { bodyId: settings.bodyIdBirthday, args: [r.name] } : undefined,
    });
    if (result.ok) {
      sent++;
      if (eventType === "birthday") birthdaySent.push(r.id);
    } else {
      failed++;
      if (result.error && errors.length < 5 && !errors.includes(result.error)) errors.push(result.error);
    }
  }

  // تبریک تولد دستی همان پیامک خودکار روز تولد است؛ کلید scheduled_sms همان تولد
  // (birthday:{شناسه}:{سال شمسی تولد پیش رو}) «ارسال‌شده» ثبت می‌شود تا خودکار دوباره نفرستد.
  if (birthdaySent.length > 0) {
    try {
      const nowMs = Date.now();
      const nowSec = Math.floor(nowMs / 1000);
      const rows = await db
        .select({ id: patientsTable.id, birthdate: patientsTable.birthdate })
        .from(patientsTable)
        .where(inArray(patientsTable.id, birthdaySent));
      for (const p of rows) {
        const year = upcomingBirthdayShamsiYear(p.birthdate, nowMs);
        if (year != null) await markScheduledSms(birthdaySmsKey(p.id, year), "birthday", "sent", nowSec);
      }
    } catch (err) {
      logger.warn({ err }, "marking manual birthday SMS failed");
    }
  }

  const label = eventType === "birthday" ? "تبریک تولد" : eventType === "loyalty_bulk" ? "گروهی به اعضای باشگاه" : "دستی";
  await logActivity("create", "sms", 0, `ارسال پیامک ${label}: ${sent} موفق، ${failed} ناموفق`);
  res.json({ total: recipients.length, sent, failed, errors });
});

// ── ارسال خدماتی (پترن) با کد دلخواه ──────────────────────────────────────────
// کاربر کد پترن (bodyId) آماده در پنل ملی‌پیامک را وارد می‌کند و پیامک برای
// یک مراجع انتخابی یا یک شماره دلخواه با متد پترن ارسال می‌شود.

router.post("/sms/send-pattern", async (req, res): Promise<void> => {
  const parsed = SendPatternSmsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { bodyId, args, patientId, phone } = parsed.data;

  if (!/^\d+$/.test(bodyId.trim())) {
    res.status(400).json({ error: "کد پترن باید فقط عدد باشد (مثلاً 465123)" });
    return;
  }

  // گیرنده: یا مراجع انتخابی، یا شماره موبایل دلخواه
  let to: string | null = null;
  let recipientName: string | null = null;
  let resolvedPatientId: number | null = null;

  if (patientId !== undefined) {
    const rows = await db
      .select({ id: patientsTable.id, name: patientsTable.name, phone: patientsTable.phone })
      .from(patientsTable)
      .where(inArray(patientsTable.id, [patientId]));
    if (rows.length === 0) {
      res.status(400).json({ error: "مراجع یافت نشد" });
      return;
    }
    to = rows[0].phone;
    recipientName = rows[0].name;
    resolvedPatientId = rows[0].id;
  } else if (phone && phone.trim()) {
    to = phone.trim();
  } else {
    res.status(400).json({ error: "گیرنده مشخص نشده است — مراجع یا شماره موبایل را وارد کنید" });
    return;
  }

  if (!normalizePhone(to)) {
    res.status(400).json({ error: "شماره موبایل معتبر نیست" });
    return;
  }

  const patternArgs = (args ?? []).map((a) => a.trim()).filter((a) => a.length > 0);

  const result = await sendSms({
    to,
    text: `پترن ${bodyId.trim()}${patternArgs.length > 0 ? ` — متغیرها: ${patternArgs.join("، ")}` : ""}`,
    eventType: "manual",
    recipientName,
    patientId: resolvedPatientId,
    pattern: { bodyId: bodyId.trim(), args: patternArgs },
  });

  await logActivity(
    "create",
    "sms",
    resolvedPatientId ?? 0,
    `ارسال پیامک خدماتی (پترن ${bodyId.trim()}) به ${recipientName ?? to}: ${result.ok ? "موفق" : "ناموفق"}`,
  );

  res.json({ ok: result.ok, error: result.error ?? null });
});

// ── کدهای پترن ذخیره‌شده (پرکاربرد) ──────────────────────────────────────────
// کاربر کدهای پترن پرکاربرد را با یک نام دلخواه ذخیره می‌کند تا هنگام ارسال
// خدماتی از فهرست انتخاب کند و مجبور به تایپ دستی کد نباشد.

function validateSavedPatternInput(name: string, bodyId: string): string | null {
  if (!name.trim()) return "نام کد پترن را وارد کنید";
  if (!/^\d+$/.test(bodyId.trim())) return "کد پترن باید فقط عدد باشد (مثلاً 465123)";
  return null;
}

router.get("/sms/patterns", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(smsSavedPatternsTable)
    .orderBy(desc(smsSavedPatternsTable.id));
  res.json({ data: rows });
});

router.post("/sms/patterns", async (req, res): Promise<void> => {
  const parsed = CreateSavedSmsPatternBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const name = parsed.data.name.trim();
  const bodyId = parsed.data.bodyId.trim();
  const invalid = validateSavedPatternInput(name, bodyId);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  const [row] = await db
    .insert(smsSavedPatternsTable)
    .values({ name, bodyId })
    .returning();
  await logActivity("create", "settings", row.id, `کد پترن پیامکی «${name}» (${bodyId}) ذخیره شد`);
  res.status(201).json(row);
});

router.put("/sms/patterns/:id", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "شناسه نامعتبر است" });
    return;
  }
  const parsed = UpdateSavedSmsPatternBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const name = parsed.data.name.trim();
  const bodyId = parsed.data.bodyId.trim();
  const invalid = validateSavedPatternInput(name, bodyId);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  const [row] = await db
    .update(smsSavedPatternsTable)
    .set({ name, bodyId })
    .where(eq(smsSavedPatternsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "کد پترن ذخیره‌شده یافت نشد" });
    return;
  }
  await logActivity("update", "settings", id, `کد پترن پیامکی «${name}» (${bodyId}) ویرایش شد`);
  res.json(row);
});

router.delete("/sms/patterns/:id", async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "شناسه نامعتبر است" });
    return;
  }
  const [row] = await db
    .delete(smsSavedPatternsTable)
    .where(eq(smsSavedPatternsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "کد پترن ذخیره‌شده یافت نشد" });
    return;
  }
  await logActivity("delete", "settings", id, `کد پترن پیامکی «${row.name}» حذف شد`);
  res.status(204).end();
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
