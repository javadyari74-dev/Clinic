import { logger } from "./logger";
import { runAutoBackup, runDailyBackupIfDue } from "./backup-service";
import { runScheduledSms } from "./scheduled-sms";

// کارهای زمان‌بندی‌شدهٔ سرور (تا وقتی برنامه باز است):
// - بکاپ خودکار: هنگام شروع، و هر ساعت بررسی «بکاپ روزانه» (۲۴ ساعت از آخرین بکاپ).
//   بکاپ هنگام بستن را برنامهٔ دسکتاپ با /api/backup/auto (reason=shutdown) می‌گیرد.
// - پیامک‌های زمان‌بندی‌شده: هر ۱۰ دقیقه (اولین بار یک دقیقه پس از شروع).
const HOUR_MS = 60 * 60 * 1000;
const SMS_INTERVAL_MS = 10 * 60 * 1000;
const SMS_FIRST_RUN_MS = 60 * 1000;

let smsRunning = false;

async function smsTick(): Promise<void> {
  if (smsRunning) return; // دور قبلی هنوز تمام نشده (مثلاً اینترنت کند)
  smsRunning = true;
  try {
    const r = await runScheduledSms();
    if (r.appointmentReminders || r.followupReminders || r.birthdays) {
      logger.info(r, "Scheduled SMS sent");
    }
  } finally {
    smsRunning = false;
  }
}

async function backupTick(): Promise<void> {
  try {
    const r = await runDailyBackupIfDue();
    if (r && !r.ok) logger.warn({ error: r.error }, "Daily backup failed");
  } catch (err) {
    logger.warn({ err }, "Daily backup failed");
  }
}

export function startSchedulers(): void {
  void runAutoBackup({ reason: "startup" })
    .then((r) => {
      if (!r.ok) logger.warn({ error: r.error }, "Startup backup failed");
    })
    .catch((err) => logger.warn({ err }, "Startup backup failed"));

  setInterval(() => void backupTick(), HOUR_MS).unref();
  setTimeout(() => void smsTick(), SMS_FIRST_RUN_MS).unref();
  setInterval(() => void smsTick(), SMS_INTERVAL_MS).unref();
}
