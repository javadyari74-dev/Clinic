import { Router, type IRouter, type Request } from "express";
import { eq } from "drizzle-orm";
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
} from "../lib/backup-service";

const router: IRouter = Router();

// نسخه فرمت فایل پشتیبان دستی — هنگام افزودن/حذف جدول افزایش یابد
const BACKUP_VERSION = 2;
const BACKUP_DIR_KEY = "backup_dir";

// GET /api/backup/download — پشتیبان کامل از تمام داده‌های مطب (به‌جز بخش لیزر)
router.get("/backup/download", async (_req, res): Promise<void> => {
  const [
    patients,
    services,
    staff,
    appointments,
    payments,
    discounts,
    inventory,
    commissions,
    recipients,
    reminders,
    notes,
    activityLog,
    expenses,
    users,
  ] = await Promise.all([
    db.select().from(patientsTable),
    db.select().from(servicesTable),
    db.select().from(staffTable),
    db.select().from(appointmentsTable),
    db.select().from(paymentsTable),
    db.select().from(discountsTable),
    db.select().from(inventoryTable),
    db.select().from(commissionsTable),
    db.select().from(commissionRecipientsTable),
    db.select().from(remindersTable),
    db.select().from(patientNotesTable),
    db.select().from(activityLogTable),
    db.select().from(expensesTable),
    db.select().from(usersTable),
  ]);

  const backup = {
    exportedAt: new Date().toISOString(),
    version: BACKUP_VERSION,
    data: {
      patients,
      services,
      staff,
      appointments,
      payments,
      discounts,
      inventory,
      commissions,
      recipients,
      reminders,
      notes,
      activityLog,
      expenses,
      users,
    },
  };

  const json = JSON.stringify(backup, null, 2);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename=clinic-backup-${Date.now()}.json`);
  res.send(json);
});

// حذف تمام داده‌های مطب (فرزند → والد). کاربران و بخش لیزر دست‌نخورده می‌مانند.
async function wipeClinicData(): Promise<void> {
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

// درج دسته‌ای با حفظ شناسه‌ها — تکه‌تکه تا از سقف پارامترهای SQLite عبور نکند
async function restoreRows(table: any, rows: unknown): Promise<void> {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(table).values(rows.slice(i, i + CHUNK));
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

  try {
    // ۱) پاک‌سازی داده‌های فعلی (فرزند → والد)
    await wipeClinicData();

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
// روتر داخلی (بدون احراز هویت) فقط برای فراخوانی از خود دستگاه (Electron هنگام خروج)
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
