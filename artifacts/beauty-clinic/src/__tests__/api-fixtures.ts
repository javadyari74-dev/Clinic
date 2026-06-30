// Realistic, URL-aware mock API responses for the route smoke test.
//
// The companion `route-smoke.test.tsx` stubs `fetch` with a never-resolving
// promise, so every page is asserted only in its *loading* state. That proves
// each lazy chunk mounts but never exercises the render path that runs once
// real data arrives — exactly where `.map` on an unexpected shape or an
// undefined field access tends to crash.
//
// This module returns shapes that match what the API server actually sends at
// runtime (verified against artifacts/api-server route handlers), so pages
// reach their loaded state and we can assert they render without throwing.

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86_400;

export const PATIENT_ONE_NAME = "علی رضایی";
export const PATIENT_TWO_NAME = "زهرا کریمی";
export const STAFF_NAME = "دکتر مریم یاری";
export const SERVICE_NAME = "لیزر فول‌بادی";
export const RECIPIENT_NAME = "کلینیک همکار";
export const DISCOUNT_NAME = "تخفیف نوروزی";
export const INVENTORY_NAME = "ژل لیزر";
export const REMINDER_TITLE = "پیگیری بیمار";
export const USER_NAME = "reception";
export const LASER_CLIENT_NAME = "سارا احمدی";
export const LASER_SERVICE_NAME = "لیزر دست و پا";

const patientOne = {
  id: 1,
  fileNumber: "1001",
  name: PATIENT_ONE_NAME,
  phone: "09120000001",
  email: "ali@example.com",
  birthdate: "1370-01-15",
  gender: "male",
  notes: "حساسیت پوستی ندارد",
  tier: "gold",
  accountBalance: 500_000,
  referrerType: "patient",
  referrerId: 2,
  referrerRate: 10,
  createdAt: NOW - 30 * DAY,
  referrerName: PATIENT_TWO_NAME,
};

const patientTwo = {
  id: 2,
  fileNumber: "1002",
  name: PATIENT_TWO_NAME,
  phone: "09120000002",
  email: null,
  birthdate: "1365-05-10",
  gender: "female",
  notes: null,
  tier: "silver",
  accountBalance: 0,
  referrerType: null,
  referrerId: null,
  referrerRate: null,
  createdAt: NOW - 60 * DAY,
  referrerName: null,
};

const patientsList = {
  data: [patientOne, patientTwo],
  total: 2,
  page: 1,
  limit: 500,
};

const upcomingBirthdays = [
  {
    patientId: 1,
    name: PATIENT_ONE_NAME,
    phone: "09120000001",
    birthdate: "1370-01-15",
    birthdayShamsiYear: 1404,
    birthdayShamsiMonth: 1,
    birthdayShamsiDay: 15,
    daysUntil: 3,
  },
];

const services = [
  {
    id: 1,
    serviceCode: "SVC-001",
    name: SERVICE_NAME,
    category: "لیزر",
    durationMinutes: 45,
    price: 1_200_000,
    doctorFee: 200_000,
    materialCost: 100_000,
    otherCost: 50_000,
    unitCount: 1,
    unitLabel: "جلسه",
    priceMode: "fixed",
    doctorFeeMode: "fixed",
    materialCostMode: "fixed",
    otherCostMode: "fixed",
    description: "لیزر تمام بدن",
    isActive: true,
  },
];

const staff = [
  {
    id: 1,
    name: STAFF_NAME,
    role: "doctor",
    phone: "09120000010",
    email: "yari@example.com",
    isActive: true,
  },
];

const appointment = {
  id: 1,
  appointmentCode: "AP-0001",
  patientId: 1,
  serviceId: 1,
  staffId: 1,
  scheduledAt: NOW + DAY,
  status: "scheduled",
  notes: "",
  price: 1_200_000,
  discountId: null,
  originalPrice: 1_200_000,
  deposit: 0,
  sessionNumber: 1,
  createdAt: NOW - DAY,
  patientName: PATIENT_ONE_NAME,
  patientPhone: "09120000001",
  patientFileNumber: "1001",
  patientTier: "gold",
  serviceName: SERVICE_NAME,
  servicePrice: 1_200_000,
  serviceCode: "SVC-001",
  staffName: STAFF_NAME,
  unitsUsed: 1,
  priceMode: "fixed",
  unitPrice: 1_200_000,
  unitLabel: "جلسه",
  serviceUnitCount: 1,
};

const appointmentsList = { data: [appointment], total: 1 };

// The receipt-only marker: a note that lives ONLY on the authoritative
// single-payment record (`paymentDetail`), never on the list row. A receipt
// that shows this text proves it was built from getPayment, not the list row.
export const PAYMENT_BACKFILL_NOTE = "یادداشت تکمیل‌شده روی سرور";

const payments = [
  {
    id: 1,
    appointmentId: 1,
    discountId: null,
    originalAmount: 1_200_000,
    amount: 1_200_000,
    method: "cash",
    paidAt: NOW - DAY,
    // The list row deliberately lacks the backfilled note that the dedicated
    // single-payment record carries — this is the missing-detail bug the
    // receipt regression test guards against.
    notes: "",
    patientName: PATIENT_ONE_NAME,
    serviceName: SERVICE_NAME,
    sessionNumber: 1,
    unitsUsed: 1,
    unitLabel: "جلسه",
    discountName: null,
    discountAmount: 0,
    depositAmount: 0,
  },
];

// The authoritative single-payment record returned by GET /api/payments/:id.
// It mirrors the list row but carries the backfilled note the list row omits,
// standing in for any detail that only the dedicated fetch surfaces.
const paymentDetail = {
  ...payments[0],
  notes: PAYMENT_BACKFILL_NOTE,
};

const inventory = [
  {
    id: 1,
    name: INVENTORY_NAME,
    category: "مصرفی",
    unit: "عدد",
    quantity: 2,
    minQuantity: 5,
    costPrice: 80_000,
    salePrice: 120_000,
    description: "ژل خنک‌کننده لیزر",
    isActive: true,
    updatedAt: NOW - DAY,
  },
];

const discounts = [
  {
    id: 1,
    name: DISCOUNT_NAME,
    code: "NOWRUZ",
    type: "percent",
    value: 20,
    minAmount: 0,
    usageLimit: 100,
    usageCount: 5,
    startDate: "2026-03-20",
    endDate: "2026-04-02",
    isActive: true,
    description: "تخفیف ویژه نوروز",
    createdAt: NOW - 10 * DAY,
  },
];

const commissionRecipients = [
  {
    id: 1,
    name: RECIPIENT_NAME,
    phone: "09120000020",
    description: "همکار معرف",
    createdAt: NOW - 40 * DAY,
  },
];

const commissions = [
  {
    id: 1,
    recipientType: "staff",
    recipientId: 1,
    appointmentId: 1,
    paymentId: 1,
    description: "کمیسیون ویزیت",
    amount: 120_000,
    rate: 10,
    status: "pending",
    isPaid: false,
    paidAt: null,
    notes: "",
    createdAt: NOW - DAY,
    recipientName: STAFF_NAME,
  },
];

const recipientReferrals = {
  recipient: commissionRecipients[0],
  referrals: [
    {
      patientId: 1,
      name: PATIENT_ONE_NAME,
      fileNumber: "1001",
      totalSpent: 1_200_000,
      referrerRate: 10,
      commission: 120_000,
    },
  ],
  totalSpent: 1_200_000,
  totalCommission: 120_000,
  count: 1,
};

const reminders = [
  {
    id: 1,
    title: REMINDER_TITLE,
    description: "تماس برای جلسه بعدی",
    type: "follow_up",
    patientId: 1,
    dueAt: NOW + 2 * DAY,
    status: "pending",
    createdAt: NOW - DAY,
    patientName: PATIENT_ONE_NAME,
    patientTier: "gold",
  },
];

const activity = [
  {
    id: 1,
    action: "create",
    entityType: "patient",
    entityId: 1,
    description: "مراجع جدید ثبت شد",
    createdAt: NOW - 3600,
  },
];

const dashboardSummary = {
  totalPatients: 2,
  appointmentsToday: 1,
  monthlyRevenue: 1_200_000,
  pendingAppointments: 1,
  completedThisMonth: 4,
  cancelledThisMonth: 0,
};

const revenueChart = [
  { date: "2026-06-28", revenue: 800_000 },
  { date: "2026-06-29", revenue: 1_200_000 },
];

const reportsSummary = {
  totalRevenue: 1_200_000,
  totalAppointments: 1,
  totalPatients: 2,
  totalPaidCommissions: 0,
  totalUnpaidCommissions: 120_000,
  appointmentsByStatus: [{ status: "scheduled", count: 1 }],
  lowStockItems: inventory,
};

const accountingSummary = {
  revenue: 1_200_000,
  expenses: 300_000,
  commissions: 120_000,
  serviceCosts: 150_000,
  totalCosts: 570_000,
  netProfit: 630_000,
  expensesByCategory: { اجاره: 200_000, مصرفی: 100_000 },
};

const accountingByService = [
  {
    serviceId: 1,
    serviceName: SERVICE_NAME,
    category: "لیزر",
    revenue: 1_200_000,
    doctorFeePerUnit: 200_000,
    materialCostPerUnit: 100_000,
    otherCostPerUnit: 50_000,
    doctorFeeTotal: 200_000,
    materialCostTotal: 100_000,
    otherCostTotal: 50_000,
    totalServiceCost: 350_000,
    commissions: 120_000,
    completedCount: 1,
    profit: 730_000,
    profitMargin: 60.8,
  },
];

const accountingChart = [
  { date: "2026-06-28", revenue: 800_000, expenses: 100_000, profit: 700_000 },
  { date: "2026-06-29", revenue: 1_200_000, expenses: 200_000, profit: 1_000_000 },
];

const expenses = [
  {
    id: 1,
    category: "اجاره",
    amount: 200_000,
    description: "اجاره مطب",
    date: NOW - 5 * DAY,
    serviceId: null,
    staffId: null,
    createdAt: NOW - 5 * DAY,
  },
];

const users = [
  {
    id: 1,
    username: "admin",
    role: "admin",
    staffId: null,
    permissions: null,
    isActive: true,
    createdAt: new Date(NOW * 1000).toISOString(),
  },
  {
    id: 2,
    username: USER_NAME,
    role: "staff",
    staffId: 1,
    permissions: JSON.stringify(["patients", "appointments"]),
    isActive: true,
    createdAt: new Date(NOW * 1000).toISOString(),
  },
];

const laserClients = [
  {
    id: 1,
    fileNumber: "L-001",
    name: LASER_CLIENT_NAME,
    phone: "09120000030",
    gender: "female",
    email: null,
    birthdate: "1372-08-20",
    skinType: "III",
    hairColor: "مشکی",
    medicalHistory: null,
    notes: null,
    createdAt: new Date(NOW * 1000).toISOString(),
  },
];

const laserServices = [
  {
    id: 1,
    code: "L-SVC-001",
    name: LASER_SERVICE_NAME,
    genderCategory: "female",
    price: 600_000,
    commissionRate: 15,
    description: "لیزر نواحی دست و پا",
    isActive: true,
    createdAt: new Date(NOW * 1000).toISOString(),
  },
];

const laserAppointments = [
  {
    id: 1,
    appointmentCode: "LA-0001",
    clientId: 1,
    serviceId: 1,
    operatorName: "اپراتور یک",
    scheduledAt: new Date((NOW + DAY) * 1000).toISOString(),
    status: "scheduled",
    sessionNumber: 1,
    price: 600_000,
    notes: null,
    createdAt: new Date(NOW * 1000).toISOString(),
    clientName: LASER_CLIENT_NAME,
    serviceName: LASER_SERVICE_NAME,
  },
];

const laserPayments = [
  {
    id: 1,
    appointmentId: 1,
    amount: 600_000,
    method: "cash",
    operatorName: "اپراتور یک",
    commissionAmount: 90_000,
    notes: null,
    nextSessionDate: null,
    nextSessionNote: null,
    paidAt: new Date(NOW * 1000).toISOString(),
    clientName: LASER_CLIENT_NAME,
    serviceName: LASER_SERVICE_NAME,
  },
];

const laserReminders = [
  {
    id: 1,
    appointmentId: 1,
    clientName: LASER_CLIENT_NAME,
    serviceName: LASER_SERVICE_NAME,
    nextSessionDate: "2026-07-15",
    nextSessionNote: "جلسه بعدی",
    phone: "09120000030",
  },
];

const laserSettings = { id: 1, commissionRate: 15 };

type Handler = () => unknown;

// Empty equivalents, matching the *shape* the API uses when there are no rows:
//   - paginated list endpoints → { data: [], total: 0 }
//   - plain collection endpoints → []
//   - aggregate/summary objects → {} (every field undefined — the most hostile
//     "brand-new clinic" shape, which is exactly where `value.toLocaleString()`
//     on an undefined field crashes)
// Single-resource detail objects (a patient, a laser client, settings) keep
// their populated value: the realistic "empty" case for a detail page is a
// record that exists but has no related rows yet, not a missing record. A
// missing record is exercised by ERROR mode instead.
const EMPTY_LIST = { data: [] as unknown[], total: 0, page: 1, limit: 500 };
const emptyArr = () => [] as unknown[];
const emptyObj = () => ({});
const emptyList = () => EMPTY_LIST;

// Ordered most-specific first. Each entry matches the request pathname (query
// string already stripped). The triple is [pattern, populatedHandler,
// emptyHandler]. Only GET endpoints fired on mount need realistic data;
// everything else falls through to a benign empty response.
const routes: Array<[RegExp, Handler, Handler]> = [
  [/\/api\/dashboard\/summary$/, () => dashboardSummary, emptyObj],
  [/\/api\/dashboard\/revenue-chart$/, () => revenueChart, emptyArr],
  [/\/api\/activity$/, () => activity, emptyArr],
  [/\/api\/reports\/summary$/, () => reportsSummary, emptyObj],
  [/\/api\/accounting\/summary$/, () => accountingSummary, emptyObj],
  [/\/api\/accounting\/by-service$/, () => accountingByService, emptyArr],
  [/\/api\/accounting\/chart$/, () => accountingChart, emptyArr],
  [/\/api\/accounting\/expenses$/, () => expenses, emptyArr],
  [/\/api\/patients\/upcoming-birthdays$/, () => upcomingBirthdays, emptyArr],
  [/\/api\/patients\/\d+\/appointments$/, () => appointmentsList, emptyList],
  [/\/api\/patients\/\d+\/account-transactions$/, emptyArr, emptyArr],
  [/\/api\/patients\/\d+\/notes$/, emptyArr, emptyArr],
  [/\/api\/patients\/\d+$/, () => patientOne, () => patientOne],
  [/\/api\/patients$/, () => patientsList, emptyList],
  [/\/api\/appointments\/today\/waiting-list$/, () => appointmentsList, emptyList],
  [/\/api\/appointments$/, () => appointmentsList, emptyList],
  [/\/api\/payments\/\d+$/, () => paymentDetail, () => paymentDetail],
  [/\/api\/payments$/, () => payments, emptyArr],
  [/\/api\/services$/, () => services, emptyArr],
  [/\/api\/staff$/, () => staff, emptyArr],
  [/\/api\/inventory$/, () => inventory, emptyArr],
  [/\/api\/discounts$/, () => discounts, emptyArr],
  [/\/api\/commissions$/, () => commissions, emptyArr],
  [/\/api\/commission-recipients\/\d+\/referrals$/, () => recipientReferrals, () => recipientReferrals],
  [/\/api\/commission-recipients$/, () => commissionRecipients, emptyArr],
  [/\/api\/reminders$/, () => reminders, emptyArr],
  [/\/api\/laser\/clients\/\d+$/, () => laserClients[0], () => laserClients[0]],
  [/\/api\/laser\/clients$/, () => laserClients, emptyArr],
  [/\/api\/laser\/services$/, () => laserServices, emptyArr],
  [/\/api\/laser\/appointments$/, () => laserAppointments, emptyArr],
  [/\/api\/laser\/payments$/, () => laserPayments, emptyArr],
  [/\/api\/laser\/reminders$/, () => laserReminders, emptyArr],
  [/\/api\/laser\/settings$/, () => laserSettings, () => laserSettings],
  [/\/api\/users$/, () => users, emptyArr],
  [/\/api\/health$/, () => ({ status: "ok" }), () => ({ status: "ok" })],
];

function pathOf(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;
  try {
    return new URL(raw, "http://localhost").pathname;
  } catch {
    return raw.split("?")[0];
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data ?? null), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export type ApiMode = "populated" | "empty" | "error";

/**
 * Build a `fetch` replacement for a given data mode:
 *
 *   - "populated" (default): realistic JSON for every endpoint the
 *     authenticated pages hit on mount. Unmatched paths return an empty array
 *     so a forgotten endpoint surfaces as a render assertion failure rather
 *     than a network hang.
 *   - "empty": the empty-but-valid shape for every endpoint ([] / {} /
 *     {data:[],total:0}), so pages are exercised against a brand-new clinic
 *     with no records.
 *   - "error": a 500 for every GET, so pages are exercised against a backend
 *     that is failing. Bodies are still valid JSON ({ error }) so the client's
 *     response parsing doesn't itself throw before the page sees the failure.
 */
export function makeMockApiFetch(mode: ApiMode = "populated") {
  return (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    if (mode === "error") {
      return Promise.resolve(
        jsonResponse({ error: "internal server error" }, 500),
      );
    }
    const path = pathOf(input);
    const match = routes.find(([pattern]) => pattern.test(path));
    if (!match) return Promise.resolve(jsonResponse([]));
    const handler = mode === "empty" ? match[2] : match[1];
    return Promise.resolve(jsonResponse(handler()));
  };
}

/** Populated-mode `fetch` replacement (kept for the loaded-state smoke test). */
export const mockApiFetch = makeMockApiFetch("populated");
