import fs from "fs";
import path from "path";
import { eq, desc, getTableColumns } from "drizzle-orm";
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
  laserClientsTable,
  laserServicesTable,
  laserAppointmentsTable,
  laserPaymentsTable,
  laserSettingsTable,
  waitingListTable,
  surveysTable,
  smsLogTable,
  loyaltyTransactionsTable,
  loyaltyMembersTable,
  smsSavedPatternsTable,
  DATA_FIX_KEY_PREFIX,
} from "@workspace/db";
import { logger } from "./logger";
import { backfillLoyaltyMembers } from "./loyalty";

// نسخه فرمت فایل پشتیبان — هنگام افزودن/حذف جدول افزایش یابد.
// نسخه ۴: افزودن لیست انتظار، نظرسنجی‌ها، لاگ پیامک، باشگاه مشتریان و بخش لیزر.
// نسخه ۵: افزودن تنظیمات برنامه (appSettings) و کدهای پترن ذخیره‌شدهٔ پیامک؛ uuid برای جدول‌های لیزر.
export const BACKUP_VERSION = 5;

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AUTO_BACKUPS = 50;
// از ۵۰ بکاپ نگه‌داشته‌شده، این تعداد تازه‌ترین‌ها همگی می‌مانند و بقیه فقط
// یکی برای هر روز — تا هم چند نسخهٔ اخیر و هم حدود یک ماه سابقهٔ روزانه داشته باشیم.
const KEEP_ALL_RECENT = 20;
const BACKUP_DIR_KEY = "backup_dir";
// پوشهٔ نسخهٔ دوم (مثلاً فلش یا پوشهٔ همگام‌شده با Google Drive)؛ خالی = غیرفعال
export const BACKUP_MIRROR_DIR_KEY = "backup_mirror_dir";
const LAST_AUTO_BACKUP_KEY = "last_auto_backup_at";

// کلیدهای app_settings که مختص همین دستگاه‌اند (مسیر پوشه‌ها، زمان آخرین اجرا،
// نشانهٔ اصلاح‌های یک‌بارهٔ داده) و نباید در پشتیبان بیایند یا با بازیابی/ادغام
// روی دستگاه دیگر نوشته شوند.
const DEVICE_LOCAL_SETTING_KEYS = new Set<string>([
  BACKUP_DIR_KEY,
  BACKUP_MIRROR_DIR_KEY,
  LAST_AUTO_BACKUP_KEY,
  "loyalty_daily_last_run",
]);

export function isDeviceLocalSettingKey(key: string): boolean {
  return (
    DEVICE_LOCAL_SETTING_KEYS.has(key) ||
    key.startsWith(DATA_FIX_KEY_PREFIX) ||
    // نشانه‌های زمان آخرین اجرای کارهای زمان‌بندی‌شده
    /_last_run$|_last_run_at$/.test(key)
  );
}

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
    laserClients,
    laserServices,
    laserAppointments,
    laserPayments,
    laserSettings,
    waitingList,
    surveys,
    smsLog,
    loyaltyTransactions,
    loyaltyMembers,
    appSettings,
    smsSavedPatterns,
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
    db.select().from(laserClientsTable),
    db.select().from(laserServicesTable),
    db.select().from(laserAppointmentsTable),
    db.select().from(laserPaymentsTable),
    db.select().from(laserSettingsTable),
    db.select().from(waitingListTable),
    db.select().from(surveysTable),
    db.select().from(smsLogTable),
    db.select().from(loyaltyTransactionsTable),
    db.select().from(loyaltyMembersTable),
    db.select().from(appSettingsTable),
    db.select().from(smsSavedPatternsTable),
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
      laserClients,
      laserServices,
      laserAppointments,
      laserPayments,
      laserSettings,
      waitingList,
      surveys,
      smsLog,
      loyaltyTransactions,
      loyaltyMembers,
      appSettings: appSettings.filter((r) => !isDeviceLocalSettingKey(r.key)),
      smsSavedPatterns,
    },
  };
}

// تبدیل مقادیر ستون‌های تاریخ (در فایل پشتیبان به‌صورت رشتهٔ ISO ذخیره شده‌اند)
// دوباره به شیء Date تا درج با حالت timestamp درایزل خطا ندهد.
export function coerceDateColumns(table: any, row: Record<string, unknown>): Record<string, unknown> {
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

// از فهرست نام فایل‌های بکاپ خودکار (تازه‌ترین اول)، کدام‌ها نگه داشته شوند:
// keepAllRecent تای اول همه، سپس فقط تازه‌ترینِ هر روز، تا سقف keep فایل.
export function selectAutoBackupsToKeep(newestFirst: string[], keep: number, keepAllRecent: number): Set<string> {
  const kept = new Set<string>();
  const days = new Set<string>();
  for (const f of newestFirst) {
    if (kept.size >= keep) break;
    const day = f.slice("auto-".length, "auto-".length + 10); // YYYY-MM-DD
    if (kept.size < keepAllRecent || !days.has(day)) {
      kept.add(f);
      days.add(day);
    }
  }
  return kept;
}

// فقط بکاپ‌های خودکار (پیشوند auto-) هرس می‌شوند؛ بکاپ‌های دستی کاربر دست‌نخورده می‌مانند.
function pruneAutoBackups(dir: string, keep: number): void {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("auto-") && f.endsWith(".json"))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    const kept = selectAutoBackupsToKeep(files.map((x) => x.f), keep, KEEP_ALL_RECENT);
    for (const { f } of files.filter((x) => !kept.has(x.f))) {
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
    await copyToMirror(dir, filename);
    return { ok: true, skipped: false, filename };
  } catch (err) {
    await logBackup("auto", null, "error", String(err));
    return { ok: false, skipped: false, error: String(err) };
  }
}

// نسخهٔ دوم: همان فایل در پوشهٔ دوم کپی می‌شود (با همان قاعدهٔ هرس). خطا در این
// مرحله بکاپ اصلی را ناموفق نمی‌کند؛ فقط در گزارش بکاپ ثبت می‌شود.
async function copyToMirror(dir: string, filename: string): Promise<void> {
  const mirror = (await getSetting(BACKUP_MIRROR_DIR_KEY))?.trim();
  if (!mirror || path.resolve(mirror) === path.resolve(dir)) return;
  try {
    fs.mkdirSync(mirror, { recursive: true });
    fs.copyFileSync(path.join(dir, filename), path.join(mirror, filename));
    pruneAutoBackups(mirror, MAX_AUTO_BACKUPS);
    await logBackup("mirror", filename, "success", mirror);
  } catch (err) {
    await logBackup("mirror", filename, "error", `کپی در پوشهٔ دوم ناموفق بود: ${describeFsError(err)}`);
  }
}

/** بکاپ روزانه: اگر از آخرین بکاپ خودکار ۲۴ ساعت گذشته باشد. */
export async function runDailyBackupIfDue(): Promise<AutoBackupResult | null> {
  const last = Number(await getSetting(LAST_AUTO_BACKUP_KEY)) || 0;
  if (last > 0 && Date.now() - last < DAY_MS) return null;
  return runAutoBackup({ reason: "daily", force: true });
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
  "waitingList",
  "surveys",
  "loyaltyTransactions",
] as const;

// بخش‌های لیزر از نسخهٔ ۵ uuid دارند؛ در فایل‌های قدیمی‌تر ردیف‌ها uuid ندارند
// و در ادغام رد می‌شوند (با یادداشت در گزارش). بازیابی کامل آن‌ها را پوشش می‌دهد.
const LASER_KEYS = ["laserClients", "laserServices", "laserAppointments", "laserPayments"] as const;

// بخش‌هایی که در فایل پشتیبان وجود دارند اما در ادغام پوشش داده نمی‌شوند و
// آگاهانه نادیده گرفته می‌شوند: لاگ پیامک (uuid ندارد؛ دادهٔ گزارشیِ مختص
// همان دستگاه است) و تنظیمات لیزر (یک ردیف تنظیم؛ تنظیم فعلی حفظ می‌شود).
// بازیابی کامل (restore) این بخش‌ها را پوشش می‌دهد.
const MERGE_IGNORED_KEYS = [
  "smsLog",
  // اعضای باشگاه uuid ندارند؛ پس از ادغام، عضویت از روی پرداخت‌ها خودکار ساخته می‌شود
  "loyaltyMembers",
  "laserSettings",
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
  // بخش‌های لیزر و پترن‌ها: فقط ساختار؛ نبودِ uuid در لیزر (فایل قدیمی) خطا نیست
  for (const key of [...LASER_KEYS, "smsSavedPatterns", "appSettings"]) {
    const arr = data[key];
    if (arr == null) continue;
    if (!Array.isArray(arr) || (arr as unknown[]).some((r) => !r || typeof r !== "object")) {
      throw new MergeError(`بخش «${key}» در فایل پشتیبان نامعتبر است`);
    }
  }
  for (const key of LASER_KEYS) {
    for (const row of (data[key] as Row[] | undefined) ?? []) {
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
  laserClients?: IdMap;
  laserServices?: IdMap;
  laserAppointments?: IdMap;
  patients: IdMap;
  services: IdMap;
  staff: IdMap;
  discounts: IdMap;
  recipients: IdMap;
  appointments: IdMap;
  payments: IdMap;
};

type MergeCount = { added: number; skipped: number };

// ستون متنی یکتا (غیر از uuid) که ممکن است در دو دستگاه مستقل مقدار یکسان گرفته باشد
// (مثل شماره پرونده یا کد لیزر): nullable → خالی می‌شود (بعداً دوباره ساخته می‌شود)،
// اجباری → پسوند «-2»، «-3» و ... می‌گیرد تا درج به خطای UNIQUE نخورد.
type UniqueTextCol = { key: string; nullable: boolean };

// ادغام یک جدول: تکراری‌ها (بر اساس uuid) رد می‌شوند؛ رکوردهای جدید با id عددی
// تازه درج و در نگاشت ثبت می‌شوند تا فرزندان به id صحیح متصل شوند.
// remap می‌تواند null برگرداند یعنی «این ردیف درج نشود» (مثلاً والدش ادغام نشده).
async function mergeTable(
  tx: any,
  table: any,
  rows: unknown,
  remap?: (row: Row) => Row | null,
  opts: { allowMissingUuid?: boolean; uniqueText?: UniqueTextCol[] } = {},
): Promise<{
  count: MergeCount;
  idMap: IdMap;
  inserted: Array<{ newId: number; row: Row }>;
  missingUuid: number;
  unresolved: number;
}> {
  const idMap: IdMap = new Map();
  const inserted: Array<{ newId: number; row: Row }> = [];
  const count: MergeCount = { added: 0, skipped: 0 };
  let missingUuid = 0;
  let unresolved = 0;
  if (!Array.isArray(rows)) return { count, idMap, inserted, missingUuid, unresolved };

  const existing = await tx
    .select({ id: table.id, uuid: table.uuid })
    .from(table);
  const existingByUuid = new Map<string, number>();
  for (const e of existing as Array<{ id: number; uuid: string }>) {
    existingByUuid.set(e.uuid, e.id);
  }

  const taken = new Map<string, Set<string>>();
  for (const u of opts.uniqueText ?? []) {
    const vals = await tx.select({ v: table[u.key] }).from(table);
    taken.set(u.key, new Set((vals as Array<{ v: unknown }>).filter((x) => x.v != null).map((x) => String(x.v))));
  }

  for (const row of rows as Row[]) {
    if (typeof row.uuid !== "string" || row.uuid.length === 0) {
      // فقط برای بخش‌هایی که فایل‌های قدیمی‌شان uuid نداشت (لیزر) — رد با یادداشت
      if (!opts.allowMissingUuid) throw new MergeError("رکوردی بدون شناسه یکتا (uuid) یافت شد");
      missingUuid++;
      count.skipped++;
      continue;
    }
    const current = existingByUuid.get(row.uuid);
    if (current !== undefined) {
      // رکورد تکراری — رکورد فعلی دست‌نخورده می‌ماند، فقط برای نگاشت فرزندان ثبت می‌شود
      idMap.set(row.id, current);
      count.skipped++;
      continue;
    }
    const { id: _oldId, ...rest } = row;
    const values = remap ? remap(coerceDateColumns(table, rest)) : coerceDateColumns(table, rest);
    if (values === null) {
      unresolved++;
      count.skipped++;
      continue;
    }
    for (const u of opts.uniqueText ?? []) {
      const set = taken.get(u.key)!;
      const v = values[u.key];
      if (v == null) continue;
      let next = String(v);
      if (set.has(next)) {
        if (u.nullable) {
          values[u.key] = null;
          continue;
        }
        let n = 2;
        while (set.has(`${v}-${n}`)) n++;
        next = `${v}-${n}`;
        values[u.key] = next;
      }
      set.add(next);
    }
    const res = await tx.insert(table).values(values).returning({ id: table.id });
    const newId = res[0].id as number;
    existingByUuid.set(row.uuid, newId);
    idMap.set(row.id, newId);
    inserted.push({ newId, row });
    count.added++;
  }

  return { count, idMap, inserted, missingUuid, unresolved };
}

// پترن‌های پیامک uuid ندارند؛ تکراری بودن بر اساس کد پترن (bodyId) تشخیص داده می‌شود.
async function mergeSmsSavedPatterns(tx: any, rows: unknown): Promise<MergeCount> {
  const count: MergeCount = { added: 0, skipped: 0 };
  if (!Array.isArray(rows)) return count;
  const existing = await tx.select({ bodyId: smsSavedPatternsTable.bodyId }).from(smsSavedPatternsTable);
  const seen = new Set<string>((existing as Array<{ bodyId: string }>).map((e) => String(e.bodyId).trim()));
  for (const row of rows as Row[]) {
    const bodyId = String(row?.bodyId ?? "").trim();
    if (!bodyId || !row?.name || seen.has(bodyId)) {
      count.skipped++;
      continue;
    }
    await tx.insert(smsSavedPatternsTable).values({
      name: String(row.name),
      bodyId,
      ...(typeof row.createdAt === "number" ? { createdAt: row.createdAt } : {}),
    });
    seen.add(bodyId);
    count.added++;
  }
  return count;
}

// تنظیمات برنامه: فقط کلیدهایی که این‌جا وجود ندارند اضافه می‌شوند؛ تنظیمات فعلی
// (مثلاً اطلاعات پنل پیامک همین دستگاه) هرگز بازنویسی نمی‌شود. کلیدهای مختص دستگاه رد می‌شوند.
async function mergeAppSettings(tx: any, rows: unknown): Promise<MergeCount> {
  const count: MergeCount = { added: 0, skipped: 0 };
  if (!Array.isArray(rows)) return count;
  const existing = await tx.select({ key: appSettingsTable.key }).from(appSettingsTable);
  const keys = new Set<string>((existing as Array<{ key: string }>).map((e) => e.key));
  for (const row of rows as Row[]) {
    const key = typeof row?.key === "string" ? row.key : "";
    if (!key || keys.has(key) || isDeviceLocalSettingKey(key)) {
      count.skipped++;
      continue;
    }
    await tx.insert(appSettingsTable).values({
      key,
      value: row.value == null ? null : String(row.value),
      updatedAt: nowSeconds(),
    });
    keys.add(key);
    count.added++;
  }
  return count;
}

async function mergeUsers(tx: any, rows: unknown, maps: Maps): Promise<MergeCount> {
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
    const { id: _oldId, ...rest } = coerceDateColumns(usersTable, row);
    // کارمند متصل به کاربر باید به id محلی همان کارمند اشاره کند
    rest.staffId = resolveRef(maps.staff, row.staffId, false, "کاربر→کارمند") ?? null;
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
  // کمیسیون معرف بیرونی با نوع «external» ذخیره می‌شود؛ «recipient»/«laser» هم
  // به جدول گیرندگان کمیسیون (commission_recipients) اشاره می‌کنند
  if (RECIPIENT_TYPES.has(type)) return resolveRef(maps.recipients, oldVal, true, label) as number;
  // نوع ناشناخته — مقدار اصلی حفظ می‌شود
  return oldVal;
}

const RECIPIENT_TYPES = new Set(["external", "recipient", "laser"]);

function remapReferrer(row: Row, maps: Maps): number | null {
  const type = row.referrerType;
  const old = row.referrerId;
  if (old == null) return null;
  if (type === "patient") return maps.patients.get(old) ?? null;
  if (type === "staff") return maps.staff.get(old) ?? null;
  if (RECIPIENT_TYPES.has(type)) return maps.recipients.get(old) ?? null;
  return old; // نوع نامشخص — حفظ مقدار اصلی
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
): Promise<{ report: MergeReport; safetyBackup?: string; ignoredSections: string[]; notes: string[] }> {
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
  const mergeNotes: string[] = [];
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

    const waitingList = await mergeTable(tx, waitingListTable, d.waitingList, (row) => ({
      ...row,
      patientId: resolveRef(maps.patients, row.patientId, true, "لیست انتظار→مراجع"),
      serviceId: resolveRef(maps.services, row.serviceId, true, "لیست انتظار→خدمت"),
      appointmentId: resolveRef(maps.appointments, row.appointmentId, false, "لیست انتظار→نوبت"),
    }));
    rep.waitingList = waitingList.count;

    const surveys = await mergeTable(tx, surveysTable, d.surveys, (row) => ({
      ...row,
      patientId: resolveRef(maps.patients, row.patientId, true, "نظرسنجی→مراجع"),
      appointmentId: resolveRef(maps.appointments, row.appointmentId, false, "نظرسنجی→نوبت"),
      paymentId: resolveRef(maps.payments, row.paymentId, false, "نظرسنجی→پرداخت"),
      serviceId: resolveRef(maps.services, row.serviceId, false, "نظرسنجی→خدمت"),
      staffId: resolveRef(maps.staff, row.staffId, false, "نظرسنجی→کارمند"),
    }));
    rep.surveys = surveys.count;

    const loyaltyTransactions = await mergeTable(
      tx,
      loyaltyTransactionsTable,
      d.loyaltyTransactions,
      (row) => ({
        ...row,
        patientId: resolveRef(maps.patients, row.patientId, true, "تراکنش امتیاز→مراجع"),
        paymentId: resolveRef(maps.payments, row.paymentId, false, "تراکنش امتیاز→پرداخت"),
      }),
    );
    rep.loyaltyTransactions = loyaltyTransactions.count;

    rep.users = await mergeUsers(tx, d.users, maps);

    rep.smsSavedPatterns = await mergeSmsSavedPatterns(tx, d.smsSavedPatterns);
    rep.appSettings = await mergeAppSettings(tx, d.appSettings);

    // ── بخش لیزر (والد → فرزند با نگاشت FK) ──
    const laserOpts = { allowMissingUuid: true };
    const laserClients = await mergeTable(tx, laserClientsTable, d.laserClients, undefined, {
      ...laserOpts,
      uniqueText: [{ key: "fileNumber", nullable: false }],
    });
    const laserServices = await mergeTable(tx, laserServicesTable, d.laserServices, undefined, {
      ...laserOpts,
      uniqueText: [{ key: "code", nullable: true }],
    });
    maps.laserClients = laserClients.idMap;
    maps.laserServices = laserServices.idMap;
    // ردیفی که والدش در ادغام نیامده (مثلاً والد بدون uuid) درج نمی‌شود
    const laserAppointments = await mergeTable(
      tx,
      laserAppointmentsTable,
      d.laserAppointments,
      (row) => {
        const clientId = maps.laserClients!.get(row.clientId);
        const serviceId = maps.laserServices!.get(row.serviceId);
        if (clientId === undefined || serviceId === undefined) return null;
        return { ...row, clientId, serviceId };
      },
      { ...laserOpts, uniqueText: [{ key: "appointmentCode", nullable: true }] },
    );
    maps.laserAppointments = laserAppointments.idMap;
    const laserPayments = await mergeTable(
      tx,
      laserPaymentsTable,
      d.laserPayments,
      (row) => {
        const appointmentId = maps.laserAppointments!.get(row.appointmentId);
        if (appointmentId === undefined) return null;
        return { ...row, appointmentId };
      },
      laserOpts,
    );
    const laser = { laserClients, laserServices, laserAppointments, laserPayments };
    for (const [key, result] of Object.entries(laser)) {
      rep[key] = result.count;
      if (result.missingUuid > 0) {
        mergeNotes.push(
          `${result.missingUuid} رکورد از بخش «${key}» شناسهٔ یکتا نداشت (فایل پشتیبان قدیمی) و ادغام نشد؛ برای آوردن آن‌ها از بازیابی کامل استفاده کنید.`,
        );
      }
      if (result.unresolved > 0) {
        mergeNotes.push(`${result.unresolved} رکورد از بخش «${key}» به‌دلیل نبودِ رکورد والد ادغام نشد.`);
      }
    }

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

  // مراجعین تازه‌ادغام‌شده که پرداخت دارند عضو باشگاه می‌شوند (اعضای باشگاه uuid
  // ندارند و مستقیم ادغام نمی‌شوند). خطا در این مرحله ادغامِ انجام‌شده را باطل نمی‌کند.
  try {
    await backfillLoyaltyMembers(nowSeconds());
  } catch (err) {
    logger.warn({ err }, "loyalty member backfill after merge failed");
  }

  // بخش‌های خارج از قرارداد ادغام که در فایل وجود داشتند و نادیده گرفته شدند
  const ignoredSections = MERGE_IGNORED_KEYS.filter(
    (key) => Array.isArray(d[key]) && (d[key] as unknown[]).length > 0,
  );

  return { report, safetyBackup: safety.filename, ignoredSections, notes: mergeNotes };
}
