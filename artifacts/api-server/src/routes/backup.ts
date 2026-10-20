import { Router, type IRouter, type Request } from "express";
import { eq, or, sql } from "drizzle-orm";
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
  loyaltyMembersTable,
  appSettingsTable,
  smsSavedPatternsTable,
  servicePriceHistoryTable,
  purchasesTable,
  purchaseProductsTable,
} from "@workspace/db";
import { timingSafeEqual } from "node:crypto";
import { logger } from "../lib/logger";
import { seedAdminUser } from "../lib/seed";
import { requireAdmin } from "../lib/auth";
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
  BACKUP_MIRROR_DIR_KEY,
  LAST_AUTO_BACKUP_KEY,
  coerceDateColumns,
  isDeviceLocalSettingKey,
  BACKUP_VERSION,
  dataFixesAppliedIn,
  syncDataFixFlagsForRestore,
  runDataFixesAfterRestore,
} from "../lib/backup-service";

const router: IRouter = Router();

const BACKUP_DIR_KEY = "backup_dir";

// GET /api/backup/download — پشتیبان کامل از تمام داده‌های مطب (شامل بخش لیزر)
// از همان منبع واحد بکاپ خودکار/ایمنی (buildBackupData) استفاده می‌کند تا
// خروجی دانلود دستی و بکاپ خودکار همیشه هم‌ساختار باشند.
// شامل هش رمز کاربران است (برای بازیابی کامل لازم است)، پس فقط مدیر؛ قاعدهٔ
// routes/index.ts هم همین را اعمال می‌کند — این‌جا لایهٔ دوم محافظت است.
router.get("/backup/download", requireAdmin, async (_req, res): Promise<void> => {
  const backup = await buildBackupData();

  const json = JSON.stringify(backup, null, 2);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename=clinic-backup-${Date.now()}.json`);
  res.send(json);
});

// همهٔ پاک‌سازی/درج‌ها داخل یک تراکنش انجام می‌شود تا خطا در میانهٔ کار
// (مثلاً فایل پشتیبان ناسازگار) به از دست رفتن داده‌های فعلی منجر نشود.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// حذف تمام داده‌های مطب (فرزند → والد). کاربران و بخش لیزر دست‌نخورده می‌مانند.
// keep: در بازیابی، بخش‌های مستقلی (خریدها) که فایل پشتیبان ندارد پاک نمی‌شوند.
async function wipeClinicData(tx: Tx, keep: { purchases?: boolean; purchaseProducts?: boolean } = {}): Promise<void> {
  await tx.delete(loyaltyTransactionsTable);
  await tx.delete(loyaltyMembersTable);
  await tx.delete(surveysTable);
  await tx.delete(servicePriceHistoryTable);
  if (!keep.purchases) await tx.delete(purchasesTable);
  if (!keep.purchaseProducts) await tx.delete(purchaseProductsTable);
  await tx.delete(waitingListTable);
  await tx.delete(smsLogTable);
  await tx.delete(patientAccountTransactionsTable);
  await tx.delete(patientNotesTable);
  await tx.delete(remindersTable);
  await tx.delete(activityLogTable);
  await tx.delete(commissionsTable);
  await tx.delete(paymentsTable);
  await tx.delete(appointmentsTable);
  await tx.delete(expensesTable);
  await tx.delete(inventoryTable);
  await tx.delete(discountsTable);
  await tx.delete(commissionRecipientsTable);
  await tx.delete(staffTable);
  await tx.delete(servicesTable);
  await tx.delete(patientsTable);
}

// حذف تمام داده‌های بخش لیزر (فرزند → والد). فقط در بازیابی استفاده می‌شود، نه در /reset.
async function wipeLaserData(tx: Tx): Promise<void> {
  await tx.delete(laserPaymentsTable);
  await tx.delete(laserAppointmentsTable);
  await tx.delete(laserClientsTable);
  await tx.delete(laserServicesTable);
  await tx.delete(laserSettingsTable);
}

// درج دسته‌ای با حفظ شناسه‌ها — تکه‌تکه تا از سقف پارامترهای SQLite عبور نکند
async function restoreRows(tx: Tx, table: any, rows: unknown): Promise<void> {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const prepared = (rows as Record<string, unknown>[]).map((r) => coerceDateColumns(table, r));
  const CHUNK = 100;
  for (let i = 0; i < prepared.length; i += CHUNK) {
    await tx.insert(table).values(prepared.slice(i, i + CHUNK));
  }
}

// نسخهٔ پایهٔ تاریخچهٔ قیمت برای خدماتی که هیچ تاریخچه‌ای ندارند (همان مایگریشن ۰۰۲۶)
async function rebuildBasePriceHistory(tx: Tx): Promise<void> {
  await tx.run(sql`
    INSERT INTO service_price_history (uuid, service_id, effective_from, price, price_mode, unit_count, doctor_fee, doctor_fee_mode, material_cost, material_cost_mode, other_cost, other_cost_mode, note, created_at)
    SELECT lower(hex(randomblob(16))), s.id, 0, s.price, COALESCE(s.price_mode, 'total'), COALESCE(s.unit_count, 1),
      COALESCE(s.doctor_fee, 0), COALESCE(s.doctor_fee_mode, 'total'), COALESCE(s.material_cost, 0), COALESCE(s.material_cost_mode, 'total'),
      COALESCE(s.other_cost, 0), COALESCE(s.other_cost_mode, 'total'), 'قیمت پیش از ثبت تاریخچه', CAST(strftime('%s','now') AS integer)
    FROM services s
    WHERE NOT EXISTS (SELECT 1 FROM service_price_history h WHERE h.service_id = s.id)
  `);
}

// DELETE /api/reset — حذف کامل تمام داده‌های مطب (کاربران و بخش لیزر حفظ می‌شوند)
router.delete("/reset", async (_req, res): Promise<void> => {
  try {
    await db.transaction((tx) => wipeClinicData(tx));
    res.json({ ok: true, message: "تمام داده‌ها پاک شدند" });
  } catch (err) {
    res.status(500).json({ error: "خطا در پاک‌سازی اطلاعات", detail: String(err) });
  }
});

// بخش‌هایی که از نخستین نسخه‌های فایل پشتیبان وجود داشته‌اند؛ بازیابی بدون مراجعین و خدمات
// (مثلاً فایل اشتباه یا ناقص) همهٔ داده‌ها را پاک می‌کرد.
const REQUIRED_RESTORE_SECTIONS = ["patients", "services"] as const;

// اعتبارسنجی فایل پیش از هر نوشتنی؛ پیام خطا یا null
function validateRestorePayload(body: any): string | null {
  const data = body?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return "فایل پشتیبان نامعتبر است";
  const version = Number(body?.version);
  if (body?.version == null || !Number.isInteger(version) || version < 1) {
    return "نسخهٔ فایل پشتیبان مشخص نیست؛ لطفاً فایل پشتیبانی را که خود برنامه ساخته است انتخاب کنید";
  }
  if (version > BACKUP_VERSION) {
    return "این فایل پشتیبان با نسخهٔ جدیدتری از برنامه ساخته شده است؛ ابتدا برنامه را به‌روز کنید";
  }
  for (const key of REQUIRED_RESTORE_SECTIONS) {
    if (!Array.isArray(data[key])) return "فایل پشتیبان ناقص است (بخش مراجعین یا خدمات را ندارد)؛ بازیابی انجام نشد";
  }
  for (const [key, value] of Object.entries(data)) {
    if (value != null && !Array.isArray(value)) return `بخش «${key}» در فایل پشتیبان نامعتبر است`;
  }
  return null;
}

// POST /api/backup/restore — بازیابی کامل از فایل پشتیبان
// تمام داده‌های فعلی مطب پاک و با داده‌های فایل جایگزین می‌شود (والد → فرزند، با حفظ شناسه‌ها)
router.post("/backup/restore", async (req, res): Promise<void> => {
  const invalid = validateRestorePayload(req.body);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  const data = req.body.data;

  // فایل‌های پشتیبان قدیمی (نسخه ۲) بخش لیزر را ندارند؛ در آن صورت داده‌های
  // لیزر فعلی نباید پاک شوند. فقط وقتی فایل شامل بخش لیزر است آن را جایگزین می‌کنیم.
  const hasLaserData =
    "laserClients" in data ||
    "laserServices" in data ||
    "laserSettings" in data ||
    "laserAppointments" in data ||
    "laserPayments" in data;

  // بکاپ ایمنی اجباری از وضعیت فعلی؛ بدون آن بازیابی (که همه چیز را جایگزین می‌کند) انجام نمی‌شود
  const safety = await runAutoBackup({ reason: "pre-restore", force: true });
  if (!safety.ok) {
    res.status(400).json({
      error:
        `بکاپ ایمنی پیش از بازیابی ناموفق بود: ${safety.error ?? "خطای نامشخص"}. ` +
        "بازیابی انجام نشد؛ لطفاً یک مسیر ذخیره بکاپ معتبر تنظیم کنید و دوباره تلاش کنید.",
    });
    return;
  }
  const fileFixes = dataFixesAppliedIn(req.body);

  try {
    await db.transaction(async (tx) => {
      // ۱) پاک‌سازی داده‌های فعلی (فرزند → والد)؛ خریدها فقط وقتی فایل آن‌ها را دارد
      await wipeClinicData(tx, {
        purchases: !Array.isArray(data.purchases),
        purchaseProducts: !Array.isArray(data.purchaseProducts),
      });
      if (hasLaserData) await wipeLaserData(tx);
      // پیامک‌های زمان‌بندی‌شده (scheduled_sms) پاک نمی‌شوند: کلیدشان به شناسهٔ نوبت/مراجع اشاره
      // می‌کند و شناسه‌ها در بازیابی حفظ می‌شوند؛ پاک‌کردنشان باعث ارسال دوبارهٔ تبریک تولد،
      // یادآوری نوبت و پیگیری‌هایی می‌شد که قبلاً فرستاده شده‌اند.
      // فایل‌های قدیمی (پیش از نسخه ۵) پترن‌ها را ندارند؛ در آن صورت پترن‌های فعلی حفظ می‌شوند
      if (Array.isArray(data.smsSavedPatterns)) await tx.delete(smsSavedPatternsTable);

      // ۲) درج مجدد (والد → فرزند) با حفظ شناسه‌ها
      await restoreRows(tx, patientsTable, data.patients);
      await restoreRows(tx, servicesTable, data.services);
      await restoreRows(tx, staffTable, data.staff);
      await restoreRows(tx, discountsTable, data.discounts);
      await restoreRows(tx, commissionRecipientsTable, data.recipients);
      await restoreRows(tx, inventoryTable, data.inventory);
      await restoreRows(tx, expensesTable, data.expenses);
      await restoreRows(tx, appointmentsTable, data.appointments);
      await restoreRows(tx, paymentsTable, data.payments);
      await restoreRows(tx, commissionsTable, data.commissions);
      await restoreRows(tx, remindersTable, data.reminders);
      await restoreRows(tx, patientNotesTable, data.notes);
      await restoreRows(tx, activityLogTable, data.activityLog);

      // ۲-الف) بخش‌های جدید (نسخه ۴) — فایل‌های قدیمی این بخش‌ها را ندارند و رد می‌شوند
      await restoreRows(tx, patientAccountTransactionsTable, data.accountTransactions);
      await restoreRows(tx, waitingListTable, data.waitingList);
      await restoreRows(tx, surveysTable, data.surveys);
      // تاریخچهٔ قیمت به شناسهٔ خدمت وابسته است و خدمات همیشه جایگزین می‌شوند، پس همیشه پاک
      // می‌شود؛ فایل‌های قدیمی که تاریخچه ندارند همین‌جا نسخهٔ پایهٔ هر خدمت را می‌گیرند (مثل مایگریشن ۰۰۲۶)
      await restoreRows(tx, servicePriceHistoryTable, data.servicePriceHistory);
      if (!Array.isArray(data.servicePriceHistory)) await rebuildBasePriceHistory(tx);
      if (Array.isArray(data.purchases)) await restoreRows(tx, purchasesTable, data.purchases);
      if (Array.isArray(data.purchaseProducts)) await restoreRows(tx, purchaseProductsTable, data.purchaseProducts);
      await restoreRows(tx, smsLogTable, data.smsLog);
      await restoreRows(tx, loyaltyTransactionsTable, data.loyaltyTransactions);
      await restoreRows(tx, loyaltyMembersTable, data.loyaltyMembers);

      // ۲-ب) بخش لیزر (والد → فرزند) با حفظ شناسه‌ها
      await restoreRows(tx, laserClientsTable, data.laserClients);
      await restoreRows(tx, laserServicesTable, data.laserServices);
      await restoreRows(tx, laserSettingsTable, data.laserSettings);
      await restoreRows(tx, laserAppointmentsTable, data.laserAppointments);
      await restoreRows(tx, laserPaymentsTable, data.laserPayments);

      // ۲-ج) نسخه ۵: پترن‌های پیامک و تنظیمات برنامه. تنظیمات upsert می‌شوند و
      // کلیدهای مختص دستگاه (مسیر بکاپ و ...) حتی اگر در فایل باشند نوشته نمی‌شوند.
      await restoreRows(tx, smsSavedPatternsTable, data.smsSavedPatterns);
      if (Array.isArray(data.appSettings)) {
        for (const r of data.appSettings) {
          const key = typeof r?.key === "string" ? r.key : "";
          if (!key || isDeviceLocalSettingKey(key)) continue;
          const value = r.value == null ? null : String(r.value);
          const updatedAt = Math.floor(Date.now() / 1000);
          await tx
            .insert(appSettingsTable)
            .values({ key, value, updatedAt })
            .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt } });
        }
      }

      // ۳) کاربران — فقط افزودن نام‌های کاربری جدید تا کاربر فعلی از سیستم خارج نشود.
      // شناسهٔ قدیمی کنار گذاشته می‌شود تا با کاربران فعلی تداخل نکند (این مسیر فقط برای مدیر باز است).
      if (Array.isArray(data.users)) {
        for (const u of data.users) {
          if (!u?.username) continue;
          const exists = await tx
            .select({ id: usersTable.id })
            .from(usersTable)
            .where(
              u.uuid
                ? or(eq(usersTable.username, u.username), eq(usersTable.uuid, u.uuid))
                : eq(usersTable.username, u.username),
            )
            .get();
          if (exists) continue;
          const { id: _oldId, ...row } = coerceDateColumns(usersTable, u);
          await tx.insert(usersTable).values(row as typeof usersTable.$inferInsert);
        }
      }

      // ۴) نشانه‌های اصلاح‌های یک‌باره مطابق دادهٔ بازیابی‌شده (نه دادهٔ پاک‌شده)
      await syncDataFixFlagsForRestore(tx, fileFixes);
    });

    // تضمین وجود حساب مدیر تا امکان ورود همیشه باقی بماند
    await seedAdminUser();

    // اصلاح‌های یک‌باره‌ای که دادهٔ فایل (پشتیبان قدیمی) هنوز نگرفته؛ خطا بازیابی را باطل نمی‌کند
    let warning: string | undefined;
    try {
      await runDataFixesAfterRestore();
    } catch (err) {
      logger.warn({ err }, "one-time data fixes after restore failed");
      warning = "اطلاعات بازیابی شد، اما اصلاح خودکار داده‌های قدیمی کامل نشد؛ با شروع دوبارهٔ برنامه تکرار می‌شود.";
    }

    res.json({ ok: true, message: "اطلاعات با موفقیت بازیابی شد", safetyBackup: safety.filename, warning });
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
    mirrorDir: (await getSetting(BACKUP_MIRROR_DIR_KEY)) ?? "",
  });
});

// PUT /api/backup/mirror — پوشهٔ نسخهٔ دوم بکاپ خودکار (خالی = غیرفعال)
router.put("/backup/mirror", requireAdmin, async (req, res): Promise<void> => {
  const dir = String(req.body?.mirrorDir ?? "").trim();
  if (dir) {
    const valid = validateBackupDir(dir);
    if (!valid.ok) {
      res.status(400).json({ error: valid.error ?? "مسیر انتخاب‌شده معتبر نیست" });
      return;
    }
  }
  await setSetting(BACKUP_MIRROR_DIR_KEY, dir);
  res.json({
    ok: true,
    mirrorDir: dir,
    message: dir ? "پوشهٔ نسخهٔ دوم ذخیره شد" : "نسخهٔ دوم غیرفعال شد",
  });
});

// POST /api/backup/run — همین الان یک بکاپ در پوشهٔ بکاپ (و پوشهٔ دوم) بگیر
router.post("/backup/run", async (_req, res): Promise<void> => {
  const result = await runAutoBackup({ reason: "manual", force: true });
  if (!result.ok) {
    res.status(500).json({ error: result.error ?? "بکاپ ناموفق بود" });
    return;
  }
  res.json(result);
});

// تغییر مسیر ذخیره بکاپ فقط برای مدیر (مقصد فایل‌هایی که هش رمزها را دارند)
router.put("/backup/settings", requireAdmin, async (req, res): Promise<void> => {
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

// GET /api/backup/last — زمان آخرین بکاپ موفق (خودکار/روزانه/دستیِ «همین الان»)
// برای نشانگر پایین منوی کناری. ok=false یعنی بکاپی نیست یا از ۲ روز قدیمی‌تر است.
const BACKUP_STALE_SEC = 2 * 86_400;
router.get("/backup/last", async (_req, res): Promise<void> => {
  const ms = Number(await getSetting(LAST_AUTO_BACKUP_KEY)) || 0;
  const lastBackupAt = ms > 0 ? Math.floor(ms / 1000) : null;
  const ok = lastBackupAt != null && Math.floor(Date.now() / 1000) - lastBackupAt <= BACKUP_STALE_SEC;
  res.json({ lastBackupAt, ok });
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
    logger.warn({ err }, "merge restore failed");
    if (err instanceof MergeError) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "خطا در بازیابی ادغامی", detail: String(err) });
  }
});

export default router;

// --------------------------------------------------------------------------
// روتر داخلی (بدون احراز هویت کاربر) فقط برای فراخوانی پوستهٔ دسکتاپ
// --------------------------------------------------------------------------
// «فقط localhost» کافی نیست: هر صفحهٔ وبی که در مرورگر همین دستگاه باز است می‌تواند به
// 127.0.0.1 درخواست بفرستد. پس درخواست باید رمز مشترکی را که فقط پوستهٔ دسکتاپ می‌داند
// (BACKUP_TRIGGER_TOKEN، هنگام اجرای سرور ساخته و به آن داده می‌شود) در هدر بفرستد؛
// درخواستِ دارای Origin (یعنی از مرورگر) هم همیشه رد می‌شود.
export const BACKUP_TRIGGER_HEADER = "x-backup-trigger-token";

function isLoopback(req: Request): boolean {
  const ip = req.ip || req.socket?.remoteAddress || "";
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip.endsWith("127.0.0.1")
  );
}

function hasTriggerToken(req: Request): boolean {
  const expected = process.env.BACKUP_TRIGGER_TOKEN ?? "";
  const got = req.get(BACKUP_TRIGGER_HEADER) ?? "";
  if (expected.length < 16 || got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export const internalBackupRouter: IRouter = Router();

// POST /api/backup/auto — گرفتن بکاپ خودکار (با رعایت throttle). فقط پوستهٔ دسکتاپ.
internalBackupRouter.post("/backup/auto", async (req, res): Promise<void> => {
  if (!isLoopback(req) || req.get("origin") != null || !hasTriggerToken(req)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const reason = req.body?.reason === "shutdown" ? "shutdown" : "auto";
  // هنگام بستن برنامه همیشه بکاپ گرفته می‌شود (بدون محدودیت ۱۵ دقیقه‌ای)
  const result = await runAutoBackup({ reason, force: reason === "shutdown" });
  res.json(result);
});
