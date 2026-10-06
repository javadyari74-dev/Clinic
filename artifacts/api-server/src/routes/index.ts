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

// کنترل دسترسی سمت سرور برای بخش‌های حساس. محدودیت منوی فرانت‌اند به‌تنهایی
// کافی نیست چون هر کاربر واردشده می‌تواند مستقیم API را صدا بزند.
// اولین قاعده‌ای که مسیر با آن شروع شود اعمال می‌شود (ترتیب مهم است).
const routeAccessRules: Array<{ prefix: string; check: RequestHandler }> = [
  // عملیات مخرب پشتیبان‌گیری فقط برای مدیر
  { prefix: "/reset", check: requireAdmin },
  { prefix: "/backup/restore", check: requireAdmin },
  { prefix: "/backup/merge", check: requireAdmin },
  { prefix: "/backup", check: requirePermission("backup") },
  // صفحهٔ کارمندان هم از revenue-range استفاده می‌کند
  { prefix: "/accounting/revenue-range", check: requirePermission("accounting", "staff") },
  { prefix: "/accounting", check: requirePermission("accounting") },
  { prefix: "/reports", check: requirePermission("reports") },
  { prefix: "/sms", check: requirePermission("sms") },
  { prefix: "/laser", check: requirePermission("laser") },
  // صفحهٔ باشگاه؛ وضعیت امتیاز هر مراجع (/patients/:id/loyalty) برای صندوق آزاد است
  { prefix: "/loyalty", check: requirePermission("loyalty") },
];

router.use((req, res, next) => {
  // مسیریابی Express به حروف بزرگ/کوچک حساس نیست؛ پس مقایسه هم باید نباشد
  const p = req.path.toLowerCase();
  const rule = routeAccessRules.find((r) => p === r.prefix || p.startsWith(`${r.prefix}/`));
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
