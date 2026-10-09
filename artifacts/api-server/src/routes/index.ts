import { Router, type IRouter, type RequestHandler } from "express";
import { requireAuth, requireAdmin, requirePermission } from "../lib/auth";
import healthRouter from "./health";
import authRouter from "./auth";
import clientErrorsRouter from "./client-errors";
import patientsRouter from "./patients";
import servicesRouter from "./services";
import staffRouter from "./staff";
import appointmentsRouter from "./appointments";
import paymentsRouter from "./payments";
import discountsRouter from "./discounts";
import inventoryRouter from "./inventory";
import commissionsRouter from "./commissions";
import commissionRecipientsRouter from "./commission-recipients";
import patientNotesRouter from "./patient-notes";
import remindersRouter from "./reminders";
import dashboardRouter from "./dashboard";
import activityRouter from "./activity";
import reportsRouter from "./reports";
import backupRouter, { internalBackupRouter } from "./backup";
import accountingRouter from "./accounting";
import laserRouter from "./laser";
import smsRouter from "./sms";
import waitingListRouter from "./waiting-list";
import surveysRouter from "./surveys";
import loyaltyRouter from "./loyalty";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(clientErrorsRouter);

// بکاپ خودکار داخلی — پیش از احراز هویت (فقط از localhost فراخوانی می‌شود)
router.use(internalBackupRouter);

router.use(requireAuth);

// کنترل دسترسی سمت سرور برای همهٔ بخش‌ها. محدودیت منوی فرانت‌اند به‌تنهایی
// کافی نیست چون هر کاربر واردشده می‌تواند مستقیم API را صدا بزند.
//
// هر قاعده یک الگوی مسیر (بخش «:» یعنی هر مقدار، مثل /patients/:/loyalty) و در صورت
// نیاز فهرست متدهاست؛ الگو با ابتدای مسیر مقایسه می‌شود. اولین قاعدهٔ منطبق اعمال
// می‌شود (ترتیب مهم است: قاعده‌های خاص‌تر بالاتر).
//
// خواندنِ داده‌هایی که صفحه‌های دیگر به‌عنوان «فهرست انتخاب» لازم دارند (خدمات، کارمندان،
// تخفیف‌ها، گیرندگان کمیسیون، جست‌وجوی مراجع) برای همان صفحه‌ها آزاد است؛ نوشتن فقط
// برای دسترسی صاحب آن بخش. پیش از تغییر هر قاعده، همهٔ فراخوان‌های فرانت‌اند
// (artifacts/beauty-clinic/src) را بررسی کنید تا صفحه‌ای با خطای ۴۰۳ نشکند.
type Rule = { pattern: string; methods?: string[]; check: RequestHandler };

const READ = ["GET", "HEAD"];
const any = (...perms: string[]) => requirePermission(...perms);

// صفحه‌هایی که مراجع را جست‌وجو/انتخاب می‌کنند (و پنجرهٔ پروفایل جست‌وجوی سراسری)
const PATIENT_LOOKUP = ["patients", "appointments", "payments", "reminders", "sms"];

export const routeAccessRules: Rule[] = [
  // ── پشتیبان‌گیری ──
  // عملیات مخرب و هر چیزی که هش رمز کاربران را بیرون می‌دهد یا مقصد فایل‌ها را عوض می‌کند فقط برای مدیر
  { pattern: "/reset", check: requireAdmin },
  { pattern: "/backup/restore", check: requireAdmin },
  { pattern: "/backup/merge", check: requireAdmin },
  { pattern: "/backup/download", check: requireAdmin },
  { pattern: "/backup/mirror", check: requireAdmin },
  { pattern: "/backup/settings", methods: ["PUT"], check: requireAdmin },
  { pattern: "/backup", check: any("backup") },

  // ── حسابداری و گزارش ──
  // صفحهٔ کارمندان هم از revenue-range استفاده می‌کند
  { pattern: "/accounting/revenue-range", check: any("accounting", "staff") },
  { pattern: "/accounting", check: any("accounting") },
  { pattern: "/reports", check: any("reports") },
  // نمودار درآمد در داشبورد و صفحهٔ گزارشات
  { pattern: "/dashboard/revenue-chart", check: any("dashboard", "reports") },
  { pattern: "/dashboard", check: any("dashboard") },
  { pattern: "/activity", check: any("dashboard") },

  { pattern: "/sms", check: any("sms") },
  { pattern: "/laser", check: any("laser") },
  { pattern: "/loyalty", check: any("loyalty") },
  { pattern: "/surveys", check: any("surveys") },
  { pattern: "/inventory", check: any("inventory") },

  // ── مراجعین ──
  // خروجی کامل اطلاعات تماس همهٔ مراجعین؛ مثل دانلود پشتیبان فقط مدیر
  { pattern: "/patients/export", check: requireAdmin },
  // داشبورد و یادآوری‌ها تولدهای پیش‌رو را نشان می‌دهند
  { pattern: "/patients/upcoming-birthdays", methods: READ, check: any("dashboard", "reminders", "patients") },
  // وضعیت امتیاز باشگاه: صندوق، پروندهٔ مراجع و صفحهٔ باشگاه
  { pattern: "/patients/:/loyalty", methods: READ, check: any("payments", "loyalty", "patients") },
  // کیف پول: صندوق (شارژ/برداشت هنگام پرداخت) و پروندهٔ مراجع
  { pattern: "/patients/:/account-transactions", check: any("payments", "patients") },
  { pattern: "/patients/:/appointments", methods: READ, check: any(...PATIENT_LOOKUP) },
  { pattern: "/patients/:/notes", methods: READ, check: any(...PATIENT_LOOKUP) },
  { pattern: "/patients/:/notes", check: any("patients") },
  { pattern: "/patients", methods: READ, check: any(...PATIENT_LOOKUP) },
  { pattern: "/patients", check: any("patients") },
  { pattern: "/patient-notes", check: any("patients") },

  // ── نوبت‌ها ──
  // داشبورد، صندوق و پروندهٔ مراجع فهرست نوبت‌ها را می‌خوانند
  { pattern: "/appointments", methods: READ, check: any("appointments", "dashboard", "payments", "patients") },
  // ثبت نوبت از پروندهٔ مراجع و پنجرهٔ جست‌وجوی سراسری هم انجام می‌شود
  { pattern: "/appointments", methods: ["POST"], check: any("appointments", "patients", "payments") },
  // حذف گروهی (DELETE /appointments/bulk) و حذف تکی فقط صاحب بخش
  { pattern: "/appointments", methods: ["DELETE"], check: any("appointments") },
  // صندوق پس از پرداخت وضعیت نوبت را «انجام‌شده» می‌کند
  { pattern: "/appointments", check: any("appointments", "payments") },
  { pattern: "/waiting-list", check: any("appointments") },

  // ── صندوق ──
  // حذف پرداخت (برگشت کیف پول/امتیاز/کمیسیون) فقط مدیر — در رابط کاربری هم فقط مدیر
  { pattern: "/payments/:", methods: ["DELETE"], check: requireAdmin },
  { pattern: "/payments", methods: READ, check: any("payments", "dashboard") },
  { pattern: "/payments", check: any("payments") },

  // ── فهرست‌های پایه (خواندن برای صفحه‌های مصرف‌کننده، نوشتن برای صاحب بخش) ──
  { pattern: "/services", methods: READ, check: any("services", ...PATIENT_LOOKUP) },
  { pattern: "/services", check: any("services") },
  { pattern: "/staff", methods: READ, check: any("staff", "commissions", ...PATIENT_LOOKUP) },
  { pattern: "/staff", check: any("staff") },
  { pattern: "/discounts", methods: READ, check: any("discounts", "payments") },
  { pattern: "/discounts", check: any("discounts") },
  { pattern: "/commission-recipients/:/referrals", check: any("commissions") },
  { pattern: "/commission-recipients", methods: READ, check: any("commissions", "payments", "patients") },
  { pattern: "/commission-recipients", check: any("commissions") },
  // صندوق کمیسیون پرداخت را ثبت می‌کند و فهرستش را می‌خواند
  { pattern: "/commissions", methods: [...READ, "POST"], check: any("commissions", "payments") },
  { pattern: "/commissions", check: any("commissions") },

  // ── یادآوری‌ها ──
  { pattern: "/reminders", methods: READ, check: any("reminders", "dashboard", "patients", "payments") },
  { pattern: "/reminders", methods: ["POST"], check: any("reminders", "patients", "payments") },
  { pattern: "/reminders", check: any("reminders") },
];

// آیا الگو با ابتدای مسیر منطبق است؟ بخش «:» با هر مقداری منطبق می‌شود.
export function matchesPattern(pattern: string, path: string): boolean {
  const pp = pattern.split("/").filter(Boolean);
  const ps = path.split("/").filter(Boolean);
  if (ps.length < pp.length) return false;
  return pp.every((seg, i) => seg === ":" || seg === ps[i]);
}

export function findAccessRule(method: string, path: string): Rule | undefined {
  // مسیریابی Express به حروف بزرگ/کوچک حساس نیست؛ پس مقایسه هم باید نباشد
  const p = path.toLowerCase();
  const m = method.toUpperCase();
  return routeAccessRules.find(
    (r) => (!r.methods || r.methods.includes(m)) && matchesPattern(r.pattern, p),
  );
}

router.use((req, res, next) => {
  const rule = findAccessRule(req.method, req.path);
  if (rule) rule.check(req, res, next);
  else next();
});

router.use(patientsRouter);
router.use(servicesRouter);
router.use(staffRouter);
router.use(appointmentsRouter);
router.use(paymentsRouter);
router.use(discountsRouter);
router.use(inventoryRouter);
router.use(commissionsRouter);
router.use(commissionRecipientsRouter);
router.use(patientNotesRouter);
router.use(remindersRouter);
router.use(dashboardRouter);
router.use(activityRouter);
router.use(reportsRouter);
router.use(backupRouter);
router.use(accountingRouter);
router.use(laserRouter);
router.use(smsRouter);
router.use(waitingListRouter);
router.use(surveysRouter);
router.use(loyaltyRouter);

export default router;
