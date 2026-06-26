import { Router, type IRouter } from "express";
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

const router: IRouter = Router();

// نسخه فرمت فایل پشتیبان — هنگام افزودن/حذف جدول افزایش یابد
const BACKUP_VERSION = 2;

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

export default router;
