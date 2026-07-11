import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppointmentCalendar, type CalendarAppointment } from "@/components/appointment-calendar";

const statusMeta = {
  scheduled: { label: "رزرو شده", color: "bg-blue-100 text-blue-700 border-blue-200" },
  confirmed: { label: "تایید شده", color: "bg-cyan-100 text-cyan-700 border-cyan-200" },
  completed: { label: "تکمیل شده", color: "bg-green-100 text-green-700 border-green-200" },
  cancelled: { label: "لغو شده", color: "bg-red-100 text-red-700 border-red-200" },
};

// نوبت‌ها روی «امروز» ساخته می‌شوند تا در نمای هفتهٔ پیش‌فرض دیده شوند
function todayAt(hour: number, minute = 0): number {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function makeApps(): CalendarAppointment[] {
  return [
    { id: 1, scheduledAt: todayAt(10, 0), patientName: "مریم احمدی", serviceName: "لیزر", status: "scheduled" },
    // دو نوبت با زمان شروع یکسان → تداخل
    { id: 2, scheduledAt: todayAt(14, 30), patientName: "سارا رضایی", serviceName: "بوتاکس", status: "confirmed" },
    { id: 3, scheduledAt: todayAt(14, 30), patientName: "نگار کریمی", serviceName: "فیشیال", status: "scheduled" },
  ];
}

function renderCalendar(overrides: Partial<Parameters<typeof AppointmentCalendar>[0]> = {}) {
  const props = {
    appointments: makeApps(),
    statusMeta,
    isAdmin: true,
    onCreateSlot: vi.fn(),
    onEditAppointment: vi.fn(),
    onMoveAppointment: vi.fn(),
    ...overrides,
  };
  render(<AppointmentCalendar {...props} />);
  return props;
}

describe("AppointmentCalendar", () => {
  it("renders the week grid with appointment blocks", () => {
    renderCalendar();
    expect(screen.getByTestId("appointment-calendar")).toBeInTheDocument();
    expect(screen.getByText("مریم احمدی")).toBeInTheDocument();
    expect(screen.getByText("لیزر")).toBeInTheDocument();
    // سربرگ روزهای هفته شمسی
    expect(screen.getByText("شنبه")).toBeInTheDocument();
    expect(screen.getByText("جمعه")).toBeInTheDocument();
  });

  it("flags appointments that start at the same time as conflicts", () => {
    renderCalendar();
    const a = screen.getByTestId("calendar-appt-2");
    const b = screen.getByTestId("calendar-appt-3");
    expect(a.title).toContain("تداخل");
    expect(b.title).toContain("تداخل");
    // نوبت بدون هم‌زمانی نباید علامت تداخل داشته باشد
    expect(screen.getByTestId("calendar-appt-1").title).not.toContain("تداخل");
  });

  it("switches between week and day modes", () => {
    renderCalendar();
    fireEvent.click(screen.getByTestId("calendar-mode-day"));
    // در نمای روز فقط یک ستون روز هست؛ نوبت‌های امروز همچنان دیده می‌شوند
    expect(screen.getByText("مریم احمدی")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("calendar-mode-week"));
    expect(screen.getByText("شنبه")).toBeInTheDocument();
  });

  it("clicking an empty slot calls onCreateSlot with the slot date and time", () => {
    const props = renderCalendar();
    const d = new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    fireEvent.click(screen.getByTestId(`calendar-create-${key}-9`));
    expect(props.onCreateSlot).toHaveBeenCalledWith(key, "09:00");
  });

  it("clicking an appointment block calls onEditAppointment", () => {
    const props = renderCalendar();
    fireEvent.click(screen.getByTestId("calendar-appt-1"));
    expect(props.onEditAppointment).toHaveBeenCalledWith(1);
  });

  it("navigating to the next week hides today's appointments", () => {
    renderCalendar();
    fireEvent.click(screen.getByTestId("calendar-next"));
    expect(screen.queryByText("مریم احمدی")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("calendar-today"));
    expect(screen.getByText("مریم احمدی")).toBeInTheDocument();
  });
});
