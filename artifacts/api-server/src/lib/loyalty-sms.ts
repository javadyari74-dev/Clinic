import { eq } from "drizzle-orm";
import { db, loyaltyMembersTable, patientsTable } from "@workspace/db";
import { logger } from "./logger";
import {
  getSmsSettings,
  getSmsTemplates,
  renderTemplate,
  sendSms,
  toPersianDigits,
  normalizePhone,
  formatToman,
} from "./sms";
import {
  TIER_LABELS,
  backfillLoyaltyMembers,
  expireLoyaltyPoints,
  getExpiringSoon,
  getWalletBalance,
  getLoyaltySettings,
  grantBirthdayBonus,
  isLoyaltyTier,
  recomputeAllTiers,
} from "./loyalty";
import { birthShamsiMonthDay, claimScheduledSms, finishScheduledSms, shamsiDateText, tehranParts } from "./scheduled-sms";
import { gregorianToJalali } from "./shamsi";
import { getSetting, setSetting } from "./backup-service";

// ─────────────────────────────────────────────────────────────────────────────
// پیامک‌ها و کارهای روزانهٔ باشگاه مشتریان. همه «آتش و فراموش»اند و هرگز خطا
// پرتاب نمی‌کنند؛ اگر باشگاه خاموش باشد هیچ کاری نمی‌کنند.
// ─────────────────────────────────────────────────────────────────────────────

async function patientContact(patientId: number) {
  return db.select({ name: patientsTable.name, phone: patientsTable.phone }).from(patientsTable)
    .where(eq(patientsTable.id, patientId)).get();
}

/** خوش‌آمد عضویت — فقط برای عضوی که تازه با پرداخت عضو شده (نه عضویت یک‌جای قبلی‌ها) */
export function fireLoyaltyWelcomeSms(patientId: number): void {
  void (async () => {
    try {
      const settings = await getSmsSettings();
      if (!settings.enabledLoyaltyWelcome) return;
      const member = await db.select().from(loyaltyMembersTable).where(eq(loyaltyMembersTable.patientId, patientId)).get();
      if (!member || member.welcomed) return;
      // پیش از ارسال علامت می‌زنیم تا دو پرداخت هم‌زمان دو خوش‌آمد نفرستند
      await db.update(loyaltyMembersTable).set({ welcomed: true }).where(eq(loyaltyMembersTable.patientId, patientId));
      const p = await patientContact(patientId);
      if (!p) return;
      const templates = await getSmsTemplates();
      const name = p.name ?? "";
      const balance = formatToman(await getWalletBalance(db, patientId));
      await sendSms({
        to: p.phone ?? "",
        text: renderTemplate(templates.loyaltyWelcome, { "نام": name, "موجودی": balance }),
        eventType: "loyalty_welcome",
        recipientName: p.name,
        patientId,
        pattern: settings.sendMode === "pattern" ? { bodyId: settings.bodyIdLoyaltyWelcome, args: [name, balance] } : undefined,
      });
    } catch (err) {
      logger.warn({ err }, "fireLoyaltyWelcomeSms failed");
    }
  })();
}

export function fireLoyaltyTierUpSms(patientId: number, tier: string): void {
  void (async () => {
    try {
      const settings = await getSmsSettings();
      if (!settings.enabledLoyaltyTierUp) return;
      const p = await patientContact(patientId);
      if (!p) return;
      const templates = await getSmsTemplates();
      const name = p.name ?? "";
      const label = isLoyaltyTier(tier) ? TIER_LABELS[tier] : tier;
      await sendSms({
        to: p.phone ?? "",
        text: renderTemplate(templates.loyaltyTierUp, { "نام": name, "سطح": label }),
        eventType: "loyalty_tier_up",
        recipientName: p.name,
        patientId,
        pattern: settings.sendMode === "pattern" ? { bodyId: settings.bodyIdLoyaltyTierUp, args: [name, label] } : undefined,
      });
    } catch (err) {
      logger.warn({ err }, "fireLoyaltyTierUpSms failed");
    }
  })();
}

export function fireLoyaltyReferralSms(referrerId: number, amount: number): void {
  void (async () => {
    try {
      const settings = await getSmsSettings();
      if (!settings.enabledLoyaltyReferral) return;
      const p = await patientContact(referrerId);
      if (!p) return;
      const templates = await getSmsTemplates();
      const name = p.name ?? "";
      const pts = formatToman(amount);
      const balance = formatToman(await getWalletBalance(db, referrerId));
      await sendSms({
        to: p.phone ?? "",
        text: renderTemplate(templates.loyaltyReferral, { "نام": name, "اعتبار": pts, "امتیاز": pts, "موجودی": balance }),
        eventType: "loyalty_referral",
        recipientName: p.name,
        patientId: referrerId,
        pattern: settings.sendMode === "pattern" ? { bodyId: settings.bodyIdLoyaltyReferral, args: [name, pts, balance] } : undefined,
      });
    } catch (err) {
      logger.warn({ err }, "fireLoyaltyReferralSms failed");
    }
  })();
}

export const EXPIRY_WARN_DAYS = 7;
const LAST_DAILY_KEY = "loyalty_daily_last_run";

/**
 * کارهای روزانهٔ باشگاه (یک‌بار در هر روز تهران، اولین دور scheduler):
 * عضویت یک‌جای مراجعین دارای پرداخت، بازمحاسبهٔ سطح (کاهش بی‌صدا)، انقضای امتیاز،
 * امتیاز هدیهٔ تولد. پیامک هشدار انقضا در هر دور (بعد از ساعت ارسال روزانه) بررسی می‌شود.
 */
// جلوگیری از دو اجرای هم‌زمان در همین فرایند (نشانگر «اجرا شد» حالا بعد از کار
// نوشته می‌شود، پس بدون این قفل دو دور هم‌زمان هر دو کار روزانه را انجام می‌دادند)
let dailyRunning = false;

export async function runLoyaltyDaily(nowMs = Date.now()): Promise<{ ran: boolean; expired: number; birthdays: number; warnings: number }> {
  const result = { ran: false, expired: 0, birthdays: 0, warnings: 0 };
  if (dailyRunning) return result;
  dailyRunning = true;
  try {
    const settings = await getLoyaltySettings();
    if (!settings.enabled) return result;
    const nowSec = Math.floor(nowMs / 1000);
    const t = tehranParts(nowMs);
    const today = `${t.y}-${t.m}-${t.d}`;

    if ((await getSetting(LAST_DAILY_KEY)) !== today) {
      result.ran = true;
      await backfillLoyaltyMembers(nowSec);
      await recomputeAllTiers(nowSec, settings);
      result.expired = await expireLoyaltyPoints(nowSec, settings);

      if (settings.birthdayBonus > 0) {
        const [, jm, jd] = gregorianToJalali(t.y, t.m, t.d);
        const rows = await db
          .select({ id: patientsTable.id, birthdate: patientsTable.birthdate })
          .from(patientsTable)
          .innerJoin(loyaltyMembersTable, eq(loyaltyMembersTable.patientId, patientsTable.id));
        for (const r of rows) {
          const b = birthShamsiMonthDay(r.birthdate);
          if (b && b.m === jm && b.d === jd && (await grantBirthdayBonus(r.id, nowSec, settings)) > 0) result.birthdays++;
        }
      }
      // نشانگر فقط پس از موفقیت کار نوشته می‌شود؛ اگر وسط کار خطا رخ دهد، دور بعدی
      // دوباره تلاش می‌کند (همهٔ مراحل بالا تکرارپذیرند: هدیهٔ تولد سالی یک‌بار است)
      await setSetting(LAST_DAILY_KEY, today);
    }

    result.warnings = await sendExpiryWarnings(nowMs);
  } catch (err) {
    logger.warn({ err }, "loyalty daily run failed");
  } finally {
    dailyRunning = false;
  }
  return result;
}

/** پیامک هشدار انقضا: یک‌بار برای هر دسته امتیازِ در شرف انقضا (کلید = اولین بسته) */
async function sendExpiryWarnings(nowMs: number): Promise<number> {
  const sms = await getSmsSettings();
  if (!sms.enabledLoyaltyExpiry || !sms.username || !sms.password) return 0;
  const loyalty = await getLoyaltySettings();
  if (tehranParts(nowMs).hour < sms.dailyAutoHour) return 0;
  const nowSec = Math.floor(nowMs / 1000);
  const soon = await getExpiringSoon(nowSec, loyalty, EXPIRY_WARN_DAYS);
  if (soon.length === 0) return 0;
  const templates = await getSmsTemplates();
  let sent = 0;
  for (const s of soon) {
    const p = await patientContact(s.patientId);
    if (!p || !normalizePhone(p.phone)) continue;
    const key = `loyalty-expiry:${s.patientId}:${Math.min(...s.lotIds)}`;
    if (!(await claimScheduledSms(key, "loyalty_expiry", nowSec, { patientId: s.patientId }))) continue;
    const name = p.name ?? "";
    const pts = formatToman(s.points);
    const date = shamsiDateText(s.expiresAt * 1000);
    const r = await sendSms({
      to: p.phone,
      text: renderTemplate(templates.loyaltyExpiry, { "نام": name, "اعتبار": pts, "امتیاز": pts, "تاریخ": date }),
      eventType: "loyalty_expiry",
      recipientName: p.name,
      patientId: s.patientId,
      pattern: sms.sendMode === "pattern" ? { bodyId: sms.bodyIdLoyaltyExpiry, args: [name, pts, date] } : undefined,
    });
    await finishScheduledSms(key, r.ok);
    if (r.ok) sent++;
  }
  return sent;
}
