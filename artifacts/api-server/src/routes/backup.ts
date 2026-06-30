import { Router, type IRouter } from "express";
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
} from "@workspace/db";
import { seedAdminUser } from "../lib/seed";

const router: IRouter = Router();

// نسخه فرمت فایل پشتیبان — هنگام افزودن/حذف جدول افزایش یابد
const BACKUP_VERSION = 3;

// GET /api/backup/download — پشتیبان کامل از تمام داده‌های مطب (شامل بخش لیزر)
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
    laserClients,
    laserServices,
    laserAppointments,
    laserPayments,
    laserSettings,
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
    db.select().from(laserClientsTable),
    db.select().from(laserServicesTable),
    db.select().from(laserAppointmentsTable),
    db.select().from(laserPaymentsTable),
    db.select().from(laserSettingsTable),
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
      laserClients,
      laserServices,
      laserAppointments,
      laserPayments,
      laserSettings,
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

export default router;
