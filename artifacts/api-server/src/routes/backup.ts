import { Router, type IRouter, type Request } from "express";
import { eq, getTableColumns } from "drizzle-orm";
import {
  db,
  patientsTable,
  servicesTable,
  staffTable,
  appointmentsTable,
  paymentsTable,
  discountsTable,
  inventoryTable,
  commissionsTable,
  commissionRecipientsTable,
  remindersTable,
  patientNotesTable,
  activityLogTable,
  expensesTable,
  usersTable,
  laserClientsTable,
  laserServicesTable,
  laserAppointmentsTable,
  laserPaymentsTable,
  laserSettingsTable,
  patientAccountTransactionsTable,
  waitingListTable,
  surveysTable,
  smsLogTable,
  loyaltyTransactionsTable,
} from "@workspace/db";
import { seedAdminUser } from "../lib/seed";
import {
  getBackupDir,
  getDefaultBackupDir,
  getBackupLogs,
  getSetting,
  setSetting,
  validateBackupDir,
  runAutoBackup,
  mergeRestore,
  MergeError,
  buildBackupData,
} from "../lib/backup-service";

const router: IRouter = Router();

const BACKUP_DIR_KEY = "backup_dir";

// GET /api/backup/download — پشتیبان کامل از تمام داده‌های مطب (شامل بخش لیزر)
// از همان منبع واحد بکاپ خودکار/ایمنی (buildBackupData) استفاده می‌کند تا
// خروجی دانلود دستی و بکاپ خودکار همیشه هم‌ساختار باشند.
router.get("/backup/download", async (_req, res): Promise<void> => {
  const backup = await buildBackupData();

  const json = JSON.stringify(backup, null, 2);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename=clinic-backup-${Date.now()}.json`);
  res.send(json);
});

// حذف تمام داده‌های مطب (فرزند → والد). کاربران و بخش لیزر دست‌نخورده می‌مانند.
async function wipeClinicData(): Promise<void> {
  await db.delete(loyaltyTransactionsTable);
  await db.delete(surveysTable);
  await db.delete(waitingListTable);
  await db.delete(smsLogTable);
  await db.delete(patientAccountTransactionsTable);
  await db.delete(patientNotesTable);
  await db.delete(remindersTable);
  await db.delete(activityLogTable);
  await db.delete(commissionsTable);
  await db.delete(paymentsTable);
  await db.delete(appointmentsTable);
  await db.delete(expensesTable);
  await db.delete(inventoryTable);
  await db.delete(discountsTable);
  await db.delete(commissionRecipientsTable);
  await db.delete(staffTable);
  await db.delete(servicesTable);
  await db.delete(patientsTable);
}

// حذف تمام داده‌های بخش لیزر (فرزند → والد). فقط در بازیابی استفاده می‌شود، نه در /reset.
async function wipeLaserData(): Promise<void> {
  await db.delete(laserPaymentsTable);
  await db.delete(laserAppointmentsTable);
  await db.delete(laserClientsTable);
  await db.delete(laserServicesTable);
  await db.delete(laserSettingsTable);
}

// تبدیل مقادیر ستون‌های تاریخ (در فایل پشتیبان به‌صورت رشتهٔ ISO ذخیره شده‌اند)
// دوباره به شیء Date تا درج با حالت timestamp درایزل خطا ندهد.
function coerceDateColumns(table: any, row: Record<string, unknown>): Record<string, unknown> {
  const cols = getTableColumns(table) as Record<string, { dataType?: string }>;
  const out: Record<string, unknown> = { ...row };
  for (const [key, col] of Object.entries(cols)) {
    const v = out[key];
    if (col?.dataType === "date" && v != null && !(v instanceof Date)) {
      out[key] = new Date(v as string | number);
    }
  }
  return out;
}

// درج دسته‌ای با حفظ شناسه‌ها — تکه‌تکه تا از سقف پارامترهای SQLite عبور نکند
async function restoreRows(table: any, rows: unknown): Promise<void> {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const prepared = (rows as Record<string, unknown>[]).map((r) => coerceDateColumns(table, r));
  const CHUNK = 100;
  for (let i = 0; i < prepared.length; i += CHUNK) {
    await db.insert(table).values(prepared.slice(i, i + CHUNK));
  }
}

// DELETE /api/reset — حذف کامل تمام داده‌های مطب (کاربران و بخش لیزر حفظ می‌شوند)
router.delete("/reset", async (_req, res): Promise<void> => {
  try {
    await wipeClinicData();
    res.json({ ok: true, message: "تمام داده‌ها پاک شدند" });
  } catch (err) {
    res.status(500).json({ error: "خطا در پاک‌سازی اطلاعات", detail: String(err) });
  }
});

// POST /api/backup/restore — بازیابی کامل از فایل پشتیبان
// تمام داده‌های فعلی مطب پاک و با داده‌های فایل جایگزین می‌شود (والد → فرزند، با حفظ شناسه‌ها)
router.post("/backup/restore", async (req, res): Promise<void> => {
  const data = req.body?.data;
  if (!data || typeof data !== "object") {
    res.status(400).json({ error: "فایل پشتیبان نامعتبر است" });
    return;
  }

  // فایل‌های پشتیبان قدیمی (نسخه ۲) بخش لیزر را ندارند؛ در آن صورت داده‌های
  // لیزر فعلی نباید پاک شوند. فقط وقتی فایل شامل بخش لیزر است آن را جایگزین می‌کنیم.
  const hasLaserData =
    "laserClients" in data ||
    "laserServices" in data ||
    "laserSettings" in data ||
    "laserAppointments" in data ||
    "laserPayments" in data;

  try {
    // ۱) پاک‌سازی داده‌های فعلی (فرزند → والد)
    await wipeClinicData();
    if (hasLaserData) await wipeLaserData();

    // ۲) درج مجدد (والد → فرزند) با حفظ شناسه‌ها
    await restoreRows(patientsTable, data.patients);
    await restoreRows(servicesTable, data.services);
    await restoreRows(staffTable, data.staff);
    await restoreRows(discountsTable, data.discounts);
    await restoreRows(commissionRecipientsTable, data.recipients);
    await restoreRows(inventoryTable, data.inventory);
    await restoreRows(expensesTable, data.expenses);
    await restoreRows(appointmentsTable, data.appointments);
    await restoreRows(paymentsTable, data.payments);
    await restoreRows(commissionsTable, data.commissions);
    await restoreRows(remindersTable, data.reminders);
    await restoreRows(patientNotesTable, data.notes);
    await restoreRows(activityLogTable, data.activityLog);

    // ۲-الف) بخش‌های جدید (نسخه ۴) — فایل‌های قدیمی این بخش‌ها را ندارند و رد می‌شوند
    await restoreRows(patientAccountTransactionsTable, data.accountTransactions);
    await restoreRows(waitingListTable, data.waitingList);
    await restoreRows(surveysTable, data.surveys);
    await restoreRows(smsLogTable, data.smsLog);
    await restoreRows(loyaltyTransactionsTable, data.loyaltyTransactions);

    // ۲-ب) بخش لیزر (والد → فرزند) با حفظ شناسه‌ها
    await restoreRows(laserClientsTable, data.laserClients);
    await restoreRows(laserServicesTable, data.laserServices);
    await restoreRows(laserSettingsTable, data.laserSettings);
    await restoreRows(laserAppointmentsTable, data.laserAppointments);
    await restoreRows(laserPaymentsTable, data.laserPayments);

    // ۳) کاربران — فقط افزودن نام‌های کاربری جدید تا کاربر فعلی از سیستم خارج نشود
    if (Array.isArray(data.users)) {
      for (const u of data.users) {
        if (!u?.username) continue;
        const exists = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.username, u.username))
          .get();
        if (!exists) await db.insert(usersTable).values(u);
      }
    }

    // تضمین وجود حساب مدیر تا امکان ورود همیشه باقی بماند
    await seedAdminUser();

    res.json({ ok: true, message: "اطلاعات با موفقیت بازیابی شد" });
  } catch (err) {
    res.status(500).json({ error: "خطا در بازیابی اطلاعات", detail: String(err) });
  }
});

// --------------------------------------------------------------------------
// تنظیمات مسیر ذخیره بکاپ
// --------------------------------------------------------------------------
router.get("/backup/settings", async (_req, res): Promise<void> => {
  const configured = await getSetting(BACKUP_DIR_KEY);
  const backupDir = await getBackupDir();
  res.json({
    backupDir,
    defaultDir: getDefaultBackupDir(),
    isDefault: !configured || configured.trim().length === 0,
  });
});

router.put("/backup/settings", async (req, res): Promise<void> => {
  const raw = req.body?.backupDir;
  // مقدار خالی یعنی بازگشت به مسیر پیش‌فرض
  if (raw == null || String(raw).trim().length === 0) {
    await setSetting(BACKUP_DIR_KEY, "");
    res.json({
      ok: true,
      backupDir: getDefaultBackupDir(),
      defaultDir: getDefaultBackupDir(),
      isDefault: true,
      message: "مسیر پیش‌فرض بکاپ فعال شد",
    });
    return;
  }
  const dir = String(raw).trim();
  const valid = validateBackupDir(dir);
  if (!valid.ok) {
    res.status(400).json({ error: valid.error ?? "مسیر انتخاب‌شده معتبر نیست" });
    return;
  }
  await setSetting(BACKUP_DIR_KEY, dir);
  res.json({
    ok: true,
    backupDir: dir,
    defaultDir: getDefaultBackupDir(),
    isDefault: false,
    message: "مسیر ذخیره بکاپ با موفقیت ذخیره شد",
  });
});

// GET /api/backup/logs — گزارش بکاپ‌های خودکار
router.get("/backup/logs", async (_req, res): Promise<void> => {
  const logs = await getBackupLogs(50);
  res.json({ logs });
});

// POST /api/backup/merge — بازیابی ادغامی بر اساس uuid (بدون از دست دادن داده‌های فعلی)
router.post("/backup/merge", async (req, res): Promise<void> => {
  try {
    const result = await mergeRestore(req.body);
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof MergeError) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "خطا در بازیابی ادغامی", detail: String(err) });
  }
});

export default router;

// --------------------------------------------------------------------------
// روتر داخلی (بدون احراز هویت) فقط برای فراخوانی از خود دستگاه
// --------------------------------------------------------------------------
function isLoopback(req: Request): boolean {
  const ip = req.ip || req.socket?.remoteAddress || "";
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip.endsWith("127.0.0.1")
  );
}

export const internalBackupRouter: IRouter = Router();

// POST /api/backup/auto — گرفتن بکاپ خودکار (با رعایت throttle). فقط از localhost.
internalBackupRouter.post("/backup/auto", async (req, res): Promise<void> => {
  if (!isLoopback(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason : "auto";
  const result = await runAutoBackup({ reason });
  res.json(result);
});
