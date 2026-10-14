import { Link } from "wouter";
import { CalendarCheck, HandCoins, Receipt, Wallet } from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { formatCurrency, formatShamsiDate, toPersianDigits } from "@/lib/format";

type ApptLike = {
  id: number;
  status: string;
  scheduledAt: number;
  paidTotal?: number | null;
  remaining?: number | null;
};

// زمان نوبت میلی‌ثانیه است؛ ردیف‌های قدیمیِ ثانیه‌ای هم درست مقایسه می‌شوند
const toMs = (ts: number) => (ts > 1e11 ? ts : ts * 1000);

/** محاسبهٔ خلاصهٔ مالی پرونده از نوبت‌ها (پرداخت‌های واقعی، نه قیمت) */
export function patientFinance(appts: ApptLike[], nowMs = Date.now()) {
  const totalPaid = appts.reduce((s, a) => s + (a.paidTotal ?? 0), 0);
  const withDebt = appts.filter((a) => a.status !== "cancelled" && (a.remaining ?? 0) > 0);
  const totalDebt = withDebt.reduce((s, a) => s + Math.max(0, a.remaining ?? 0), 0);
  // قدیمی‌ترین نوبت بدهکار برای دریافت بدهی
  const oldestDebt = [...withDebt].sort((a, b) => toMs(a.scheduledAt) - toMs(b.scheduledAt))[0] ?? null;
  const lastVisit = appts
    .filter((a) => a.status !== "cancelled" && a.status !== "no_show" && toMs(a.scheduledAt) <= nowMs)
    .reduce<number | null>((m, a) => (m == null || toMs(a.scheduledAt) > m ? toMs(a.scheduledAt) : m), null);
  return { totalPaid, totalDebt, oldestDebt, lastVisit };
}

/** ردیف کارت‌های کوچک خلاصهٔ مالی بالای پرونده */
export function PatientFinancialSummary({
  appointments,
  walletBalance,
  canSettle,
}: {
  appointments: ApptLike[];
  walletBalance: number | null | undefined;
  /** نمایش «دریافت بدهی» (دسترسی صندوق) */
  canSettle: boolean;
}) {
  const { totalPaid, totalDebt, oldestDebt, lastVisit } = patientFinance(appointments);
  const tile = "p-3.5 rounded-2xl [&_.text-2xl]:text-lg";
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="patient-financial-summary">
      <StatCard
        className={tile}
        tone="rose"
        icon={<Receipt />}
        title="کل پرداختی"
        value={formatCurrency(totalPaid)}
        sub={`${toPersianDigits(appointments.length)} نوبت`}
        testId="patient-total-paid"
      />
      <StatCard
        className={tile}
        tone="wine"
        icon={<HandCoins />}
        title="بدهی"
        value={<span data-testid={totalDebt > 0 ? "patient-debt" : undefined}>{formatCurrency(totalDebt)}</span>}
        sub={totalDebt > 0 && oldestDebt && canSettle ? (
          <Link
            href={`/payments?appointmentId=${oldestDebt.id}`}
            className="mt-1 inline-flex items-center rounded-full bg-white/20 px-2.5 py-0.5 font-bold text-white hover:bg-white/30"
            data-testid="link-collect-debt"
          >
            دریافت بدهی
          </Link>
        ) : totalDebt > 0 ? "مانده از نوبت‌های قبلی" : "بدون بدهی"}
      />
      <StatCard
        className={tile}
        tone="amber"
        icon={<Wallet />}
        title="کیف پول"
        value={formatCurrency(walletBalance ?? 0)}
        testId="patient-wallet"
      />
      <StatCard
        className={tile}
        tone="pink"
        icon={<CalendarCheck />}
        title="آخرین مراجعه"
        value={lastVisit ? formatShamsiDate(lastVisit) : "—"}
        testId="patient-last-visit"
      />
    </div>
  );
}
