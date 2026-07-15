import fs from "fs";
import path from "path";
import { eq, desc } from "drizzle-orm";
import {
  db,
  DB_PATH,
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
  patientAccountTransactionsTable,
  appSettingsTable,
  backupLogTable,
} from "@workspace/db";
import { logger } from "./logger";

// نسخه فرمت فایل پشتیبان — با افزودن جدول تراکنش‌های حساب به ۳ افزایش یافت.
export const BACKUP_VERSION = 3;

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const MAX_AUTO_BACKUPS = 50;
const BACKUP_DIR_KEY = "backup_dir";
const LAST_AUTO_BACKUP_KEY = "last_auto_backup_at";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// خطای قابل‌نمایش به کاربر (۴۰۰) — جدا از خطاهای غیرمنتظره سرور (۵۰۰).
export class MergeError extends Error {}

// ---------------------------------------------------------------------------
// تنظیمات کلید/مقدار
// ---------------------------------------------------------------------------
export async function getSetting(key: string): Promise<string | null> {
  const row = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, key))
    .get();
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettingsTable)
    .values({ key, value, updatedAt: nowSeconds() })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value, updatedAt: nowSeconds() },
    });
}

// ---------------------------------------------------------------------------
// مسیر ذخیره بکاپ
// ---------------------------------------------------------------------------
export function getDefaultBackupDir(): string {
  return path.join(path.dirname(DB_PATH), "backups");
}

export async function getBackupDir(): Promise<string> {
  const configured = await getSetting(BACKUP_DIR_KEY);
  if (configured && configured.trim().length > 0) return configured;
  return getDefaultBackupDir();
}

function describeFsError(err: unknown): string {
  const code = (err as { code?: string })?.code;
  if (code === "EACCES" || code === "EPERM") return "دسترسی نوشتن به این مسیر وجود ندارد";
  if (code === "ENOENT") return "مسیر معتبر نیست یا قابل ساخت نیست";
  if (code === "ENOTDIR") return "مسیر انتخاب‌شده یک پوشه نیست";
  return (err as Error)?.message ?? "خطای نامشخص در دسترسی به مسیر";
}

// بررسی وجود/قابل‌ساخت‌بودن پوشه و دسترسی نوشتن (با نوشتن و حذف یک فایل آزمایشی).
export function validateBackupDir(dir: string): { ok: boolean; error?: string } {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const testFile = path.join(dir, `.write-test-${Date.now()}`);
    fs.writeFileSync(testFile, "ok");
    fs.unlinkSync(testFile);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describeFsError(err) };
  }
}

// ---------------------------------------------------------------------------
// ساخت داده‌ی پشتیبان (منبع واحد برای دانلود دستی، بکاپ خودکار و بکاپ ایمنی)
// ---------------------------------------------------------------------------
export async function buildBackupData(): Promise<{
  exportedAt: string;
  version: number;
  data: Record<string, unknown[]>;
}> {
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
    accountTransactions,
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
    db.select().from(patientAccountTransactionsTable),
  ]);

  return {
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
      accountTransactions,
    },
  };
}

function fileTimestamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  );
}

async function writeBackupFile(dir: string, prefix: string): Promise<string> {
  fs.mkdirSync(dir, { recursive: true });
  const backup = await buildBackupData();
  const filename = `${prefix}${fileTimestamp()}.json`;
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(backup, null, 2));
  return filename;
}

// فقط بکاپ‌های خودکار (پیشوند auto-) هرس می‌شوند؛ بکاپ‌های دستی کاربر دست‌نخورده می‌مانند.
function pruneAutoBackups(dir: string, keep: number): void {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("auto-") && f.endsWith(".json"))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(keep)) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch {
        /* ignore individual failures */
      }
    }
  } catch {
    /* ignore */
  }
}

async function logBackup(
  kind: string,
  filename: string | null,
  status: "success" | "error",
  message: string,
): Promise<void> {
  try {
    await db
      .insert(backupLogTable)
      .values({ kind, filename, status, message, createdAt: nowSeconds() });
  } catch (err) {
    // ثبت لاگ هرگز نباید مانع بکاپ شود
    logger.warn({ err }, "failed to write backup_log entry");
  }
}

export type AutoBackupResult = {
  ok: boolean;
  skipped: boolean;
  filename?: string;
  error?: string;
};

// بکاپ خودکار: throttle ۱۵ دقیقه‌ای (مگر force)، نوشتن فایل auto-، هرس تا ۵۰ مورد، ثبت لاگ.
export async function runAutoBackup(
  opts: { reason?: string; force?: boolean } = {},
): Promise<AutoBackupResult> {
  const { reason = "auto", force = false } = opts;
  const dir = await getBackupDir();

  const valid = validateBackupDir(dir);
  if (!valid.ok) {
    await logBackup("auto", null, "error", `مسیر بکاپ نامعتبر است: ${valid.error}`);
    return { ok: false, skipped: false, error: valid.error };
  }

  if (!force) {
    const last = Number(await getSetting(LAST_AUTO_BACKUP_KEY)) || 0;
    if (last > 0 && Date.now() - last < FIFTEEN_MINUTES_MS) {
      return { ok: true, skipped: true };
    }
  }

  try {
    const filename = await writeBackupFile(dir, "auto-");
    pruneAutoBackups(dir, MAX_AUTO_BACKUPS);
    await setSetting(LAST_AUTO_BACKUP_KEY, String(Date.now()));
    const kind = reason === "pre-merge" ? "pre-merge" : "auto";
    await logBackup(kind, filename, "success", reason);
    return { ok: true, skipped: false, filename };
  } catch (err) {
    await logBackup("auto", null, "error", String(err));
    return { ok: false, skipped: false, error: String(err) };
  }
}

export async function getBackupLogs(limit = 50) {
  return db
    .select()
    .from(backupLogTable)
    .orderBy(desc(backupLogTable.id))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// بازیابی ادغامی (Merge Restore) — تشخیص تکراری بر اساس uuid، نگاشت FK عددی
// ---------------------------------------------------------------------------
type Row = Record<string, any>;
type IdMap = Map<number, number>;

// کلیدهای مورد انتظار در فایل پشتیبان که رکوردهایشان باید uuid و id داشته باشند.
const RECORD_KEYS = [
  "patients",
  "services",
  "staff",
  "appointments",
  "payments",
  "discounts",
  "inventory",
  "commissions",
  "recipients",
  "reminders",
  "notes",
  "activityLog",
  "expenses",
  "users",
  "accountTransactions",
] as const;

// اعتبارسنجی اولیه: ساختار درست، و هر رکورد دارای uuid رشته‌ای و id عددی.
function preValidate(data: Record<string, unknown>): void {
  for (const key of RECORD_KEYS) {
    const arr = data[key];
    if (arr == null) continue;
    if (!Array.isArray(arr)) {
      throw new MergeError(`بخش «${key}» در فایل پشتیبان نامعتبر است`);
    }
    for (const row of arr as Row[]) {
      if (!row || typeof row !== "object") {
        throw new MergeError(`رکورد نامعتبر در بخش «${key}» یافت شد`);
      }
      if (typeof row.uuid !== "string" || row.uuid.length === 0) {
        throw new MergeError(
          "رکوردی بدون شناسه یکتا (uuid) در فایل پشتیبان یافت شد؛ عملیات ادغام متوقف شد",
        );
      }
      if (typeof row.id !== "number") {
        throw new MergeError(`رکوردی بدون شناسه عددی معتبر در بخش «${key}» یافت شد`);
      }
    }
  }
}

function resolveRef(
  map: IdMap,
  oldVal: number | null | undefined,
  required: boolean,
  label: string,
): number | null | undefined {
  if (oldVal == null) {
    if (required) throw new MergeError(`ارجاع ضروری «${label}» خالی است`);
    return oldVal ?? null;
  }
  const mapped = map.get(oldVal);
  if (mapped === undefined) {
    if (required) {
      throw new MergeError(`ارجاع «${label}» در فایل پشتیبان قابل حل نیست`);
    }
    return null;
  }
  return mapped;
}

type Maps = {
  patients: IdMap;
  services: IdMap;
  staff: IdMap;
  discounts: IdMap;
  recipients: IdMap;
  appointments: IdMap;
  payments: IdMap;
};

type MergeCount = { added: number; skipped: number };

// ادغام یک جدول: تکراری‌ها (بر اساس uuid) رد می‌شوند؛ رکوردهای جدید با id عددی
// تازه درج و در نگاشت ثبت می‌شوند تا فرزندان به id صحیح متصل شوند.
async function mergeTable(
  tx: any,
  table: any,
  rows: unknown,
  remap?: (row: Row) => Row,
): Promise<{ count: MergeCount; idMap: IdMap; inserted: Array<{ newId: number; row: Row }> }> {
  const idMap: IdMap = new Map();
  const inserted: Array<{ newId: number; row: Row }> = [];
  const count: MergeCount = { added: 0, skipped: 0 };
  if (!Array.isArray(rows)) return { count, idMap, inserted };

  const existing = await tx
    .select({ id: table.id, uuid: table.uuid })
    .from(table);
  const existingByUuid = new Map<string, number>();
  for (const e of existing as Array<{ id: number; uuid: string }>) {
    existingByUuid.set(e.uuid, e.id);
  }

  for (const row of rows as Row[]) {
    const current = existingByUuid.get(row.uuid);
    if (current !== undefined) {
      // رکورد تکراری — رکورد فعلی دست‌نخورده می‌ماند، فقط برای نگاشت فرزندان ثبت می‌شود
      idMap.set(row.id, current);
      count.skipped++;
      continue;
    }
    const { id: _oldId, ...rest } = row;
    const values = remap ? remap(rest) : rest;
    const res = await tx.insert(table).values(values).returning({ id: table.id });
    const newId = res[0].id as number;
    idMap.set(row.id, newId);
    inserted.push({ newId, row });
    count.added++;
  }

  return { count, idMap, inserted };
}

async function mergeUsers(tx: any, rows: unknown): Promise<MergeCount> {
  const count: MergeCount = { added: 0, skipped: 0 };
  if (!Array.isArray(rows)) return count;
  const existing = await tx
    .select({ uuid: usersTable.uuid, username: usersTable.username })
    .from(usersTable);
  const byUuid = new Set<string>();
  const byName = new Set<string>();
  for (const e of existing as Array<{ uuid: string; username: string }>) {
    byUuid.add(e.uuid);
    byName.add(e.username);
  }
  for (const row of rows as Row[]) {
    // نام کاربری یکتا است؛ برای جلوگیری از تصادف، هم uuid و هم username بررسی می‌شود
    if (byUuid.has(row.uuid) || byName.has(row.username)) {
      count.skipped++;
      continue;
    }
    const { id: _oldId, ...rest } = row;
    await tx.insert(usersTable).values(rest);
    byUuid.add(row.uuid);
    byName.add(row.username);
    count.added++;
  }
  return count;
}

function resolvePolyRequired(
  type: string,
  oldVal: number,
  maps: Maps,
  label: string,
): number {
  if (type === "staff") return resolveRef(maps.staff, oldVal, true, label) as number;
  if (type === "patient") return resolveRef(maps.patients, oldVal, true, label) as number;
  if (type === "recipient") return resolveRef(maps.recipients, oldVal, true, label) as number;
  // نوع خارج از دامنه‌ی ادغام (مثلاً laser) — مقدار اصلی حفظ می‌شود
  return oldVal;
}

function remapReferrer(row: Row, maps: Maps): number | null {
  const type = row.referrerType;
  const old = row.referrerId;
  if (old == null) return null;
  if (type === "patient") return maps.patients.get(old) ?? null;
  if (type === "staff") return maps.staff.get(old) ?? null;
  if (type === "recipient") return maps.recipients.get(old) ?? null;
  return old; // laser/نامشخص — حفظ مقدار اصلی
}

function remapActivityEntity(row: Row, maps: Maps): number | null {
  const type = row.entityType;
  const old = row.entityId;
  if (old == null) return null;
  const map: IdMap | undefined = {
    patient: maps.patients,
    service: maps.services,
    staff: maps.staff,
    discount: maps.discounts,
    recipient: maps.recipients,
    appointment: maps.appointments,
    payment: maps.payments,
  }[type as string];
  if (!map) return old; // نوع بدون نگاشت — حفظ مقدار اصلی (داده‌ی گزارشی)
  return map.get(old) ?? old;
}

export type MergeReport = Record<string, MergeCount> & {
  totals: { added: number; skipped: number };
};

export async function mergeRestore(
  payload: { data?: unknown },
): Promise<{ report: MergeReport; safetyBackup?: string }> {
  const data = payload?.data;
  if (!data || typeof data !== "object") {
    throw new MergeError("فایل پشتیبان نامعتبر است");
  }
  const d = data as Record<string, unknown>;

  // ۱) اعتبارسنجی کامل پیش از هر نوشتنی
  preValidate(d);

  // ۲) بکاپ ایمنی اجباری از دیتابیس فعلی پیش از ادغام
  const safety = await runAutoBackup({ reason: "pre-merge", force: true });
  if (!safety.ok) {
    throw new MergeError(
      `بکاپ ایمنی پیش از ادغام ناموفق بود: ${safety.error ?? "خطای نامشخص"}. ` +
        "لطفاً یک مسیر ذخیره بکاپ معتبر تنظیم کنید و دوباره تلاش کنید.",
    );
  }

  // ۳) ادغام درون یک تراکنش — هر خطایی کل عملیات را برمی‌گرداند و دیتابیس دست‌نخورده می‌ماند
  const report = await db.transaction(async (tx) => {
    const rep: Record<string, MergeCount> = {};

    const services = await mergeTable(tx, servicesTable, d.services);
    rep.services = services.count;
    const staff = await mergeTable(tx, staffTable, d.staff);
    rep.staff = staff.count;
    const discounts = await mergeTable(tx, discountsTable, d.discounts);
    rep.discounts = discounts.count;
    const inventory = await mergeTable(tx, inventoryTable, d.inventory);
    rep.inventory = inventory.count;
    const recipients = await mergeTable(tx, commissionRecipientsTable, d.recipients);
    rep.recipients = recipients.count;

    // مراجعین — نگاشت referrerId در پایان (پس از کامل‌شدن تمام نگاشت‌ها) انجام می‌شود
    const patients = await mergeTable(tx, patientsTable, d.patients);
    rep.patients = patients.count;

    const maps: Maps = {
      patients: patients.idMap,
      services: services.idMap,
      staff: staff.idMap,
      discounts: discounts.idMap,
      recipients: recipients.idMap,
      appointments: new Map(),
      payments: new Map(),
    };

    const appointments = await mergeTable(tx, appointmentsTable, d.appointments, (row) => ({
      ...row,
      patientId: resolveRef(maps.patients, row.patientId, true, "نوبت→مراجع"),
      serviceId: resolveRef(maps.services, row.serviceId, true, "نوبت→خدمت"),
      staffId: resolveRef(maps.staff, row.staffId, false, "نوبت→کارمند"),
      discountId: resolveRef(maps.discounts, row.discountId, false, "نوبت→تخفیف"),
    }));
    rep.appointments = appointments.count;
    maps.appointments = appointments.idMap;

    const payments = await mergeTable(tx, paymentsTable, d.payments, (row) => ({
      ...row,
      appointmentId: resolveRef(maps.appointments, row.appointmentId, true, "پرداخت→نوبت"),
      discountId: resolveRef(maps.discounts, row.discountId, false, "پرداخت→تخفیف"),
    }));
    rep.payments = payments.count;
    maps.payments = payments.idMap;

    const commissions = await mergeTable(tx, commissionsTable, d.commissions, (row) => ({
      ...row,
      recipientId: resolvePolyRequired(row.recipientType, row.recipientId, maps, "کمیسیون→دریافت‌کننده"),
      appointmentId: resolveRef(maps.appointments, row.appointmentId, false, "کمیسیون→نوبت"),
      paymentId: resolveRef(maps.payments, row.paymentId, false, "کمیسیون→پرداخت"),
    }));
    rep.commissions = commissions.count;

    const notes = await mergeTable(tx, patientNotesTable, d.notes, (row) => ({
      ...row,
      patientId: resolveRef(maps.patients, row.patientId, true, "یادداشت→مراجع"),
    }));
    rep.notes = notes.count;

    const accountTransactions = await mergeTable(
      tx,
      patientAccountTransactionsTable,
      d.accountTransactions,
      (row) => ({
        ...row,
        patientId: resolveRef(maps.patients, row.patientId, true, "تراکنش حساب→مراجع"),
        paymentId: resolveRef(maps.payments, row.paymentId, false, "تراکنش حساب→پرداخت"),
      }),
    );
    rep.accountTransactions = accountTransactions.count;

    const reminders = await mergeTable(tx, remindersTable, d.reminders, (row) => ({
      ...row,
      patientId: resolveRef(maps.patients, row.patientId, false, "یادآوری→مراجع"),
    }));
    rep.reminders = reminders.count;

    const expenses = await mergeTable(tx, expensesTable, d.expenses, (row) => ({
      ...row,
      serviceId: resolveRef(maps.services, row.serviceId, false, "هزینه→خدمت"),
      staffId: resolveRef(maps.staff, row.staffId, false, "هزینه→کارمند"),
    }));
    rep.expenses = expenses.count;

    const activityLog = await mergeTable(tx, activityLogTable, d.activityLog, (row) => ({
      ...row,
      entityId: remapActivityEntity(row, maps),
    }));
    rep.activityLog = activityLog.count;

    rep.users = await mergeUsers(tx, d.users);

    // نگاشت پایانی معرّف مراجعین جدید (پس از کامل‌شدن تمام نگاشت‌ها)
    for (const { newId, row } of patients.inserted) {
      if (row.referrerId == null) continue;
      const remapped = remapReferrer(row, maps);
      if (remapped !== row.referrerId) {
        await tx
          .update(patientsTable)
          .set({ referrerId: remapped })
          .where(eq(patientsTable.id, newId));
      }
    }

    const totals = Object.values(rep).reduce(
      (acc, c) => ({ added: acc.added + c.added, skipped: acc.skipped + c.skipped }),
      { added: 0, skipped: 0 },
    );
    return { ...rep, totals } as MergeReport;
  });

  return { report, safetyBackup: safety.filename };
}
