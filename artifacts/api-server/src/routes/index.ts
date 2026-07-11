import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";
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

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(clientErrorsRouter);
// بکاپ خودکار داخلی — پیش از احراز هویت (فقط از localhost فراخوانی می‌شود)
router.use(internalBackupRouter);

router.use(requireAuth);

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

export default router;
