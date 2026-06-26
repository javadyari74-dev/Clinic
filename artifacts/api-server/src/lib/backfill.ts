import { eq, or, isNull, like } from "drizzle-orm";
import {
  db,
  appointmentsTable,
  paymentsTable,
  patientsTable,
  servicesTable,
} from "@workspace/db";
import { generateUniqueAppointmentCode } from "./appointment-code";

export async function backfillAppointmentCodes(): Promise<void> {
  const needsCode = await db
    .select({ id: appointmentsTable.id })
    .from(appointmentsTable)
    .where(or(isNull(appointmentsTable.appointmentCode), like(appointmentsTable.appointmentCode, "APT-%")));

  if (needsCode.length === 0) return;

  for (const appt of needsCode) {
    const appointmentCode = await generateUniqueAppointmentCode();
    await db
      .update(appointmentsTable)
      .set({ appointmentCode })
      .where(eq(appointmentsTable.id, appt.id));
  }
}

// نسخه‌های قدیمی پرداخت‌ها فاقد جزئیات (مراجع/خدمت/شماره جلسه/واحد) بودند.
// این تابع آن‌ها را از روی نوبت مرتبط پر می‌کند تا رسید همه پرداخت‌ها کامل باشد.
export async function backfillPaymentSnapshots(): Promise<void> {
  const needsSnapshot = await db
    .select({
      paymentId: paymentsTable.id,
      patientName: patientsTable.name,
      serviceName: servicesTable.name,
      sessionNumber: appointmentsTable.sessionNumber,
      unitLabel: servicesTable.unitLabel,
    })
    .from(paymentsTable)
    .leftJoin(appointmentsTable, eq(paymentsTable.appointmentId, appointmentsTable.id))
    .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .leftJoin(servicesTable, eq(appointmentsTable.serviceId, servicesTable.id))
    .where(isNull(paymentsTable.patientName));

  if (needsSnapshot.length === 0) return;

  for (const row of needsSnapshot) {
    await db
      .update(paymentsTable)
      .set({
        patientName: row.patientName ?? null,
        serviceName: row.serviceName ?? null,
        sessionNumber: row.sessionNumber ?? null,
        unitLabel: row.unitLabel ?? null,
      })
      .where(eq(paymentsTable.id, row.paymentId));
  }
}
