import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Surveys from "@/pages/surveys";
import { dateToUnixSeconds } from "@/lib/format";

// PersianDatePicker (react-multi-date-picker) با یک input ساده جایگزین می‌شود
// تا انتخاب تاریخ در jsdom قطعی و بدون درگیری با تقویم بازشو باشد؛ قرارداد
// همان است: مقدار میلادی "YYYY-MM-DD" و "" برای پاک‌کردن.
vi.mock("@/components/persian-date-picker", () => ({
  PersianDatePicker: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => (
    <input
      aria-label={placeholder}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const SURVEY_PATIENT = "علی رضایی";

const surveyRow = {
  id: 1,
  uuid: "u-1",
  patientId: 1,
  appointmentId: null,
  paymentId: null,
  serviceId: 1,
  staffId: 1,
  sentAt: 1_780_000_000,
  smsStatus: "sent",
  score: null,
  comment: null,
  scoredAt: null,
  createdAt: 1_780_000_000,
  patientName: SURVEY_PATIENT,
  patientPhone: "09121234567",
  serviceName: "لیزر فول‌بادی",
  staffName: "دکتر مریم یاری",
};

// هر درخواست /api/surveys ثبت می‌شود؛ با فیلتر بازه (from/to) نتیجه خالی
// برمی‌گردد تا حالت «در این بازه یافت نشد» هم تمرین شود. total=45 یعنی دو صفحه.
let requests: URL[] = [];

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function installFetchMock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      const url = new URL(raw, "http://localhost");
      if (/\/api\/surveys$/.test(url.pathname)) {
        requests.push(url);
        const hasRange = url.searchParams.has("from") || url.searchParams.has("to");
        return jsonResponse(
          hasRange ? { data: [], total: 0 } : { data: [surveyRow], total: 45 },
        );
      }
      return jsonResponse([]);
    }),
  );
}

function lastSurveysRequest(): URL {
  expect(requests.length).toBeGreaterThan(0);
  return requests[requests.length - 1];
}

function renderSurveys() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Surveys />
    </QueryClientProvider>,
  );
}

describe("dateToUnixSeconds", () => {
  it("ابتدای روز را به ثانیه یونیکس محلی تبدیل می‌کند", () => {
    expect(dateToUnixSeconds("2026-07-01", false)).toBe(
      Math.floor(new Date(2026, 6, 1, 0, 0, 0).getTime() / 1000),
    );
  });

  it("انتهای روز ۲۳:۵۹:۵۹ همان روز است", () => {
    expect(dateToUnixSeconds("2026-07-01", true)).toBe(
      Math.floor(new Date(2026, 6, 1, 23, 59, 59).getTime() / 1000),
    );
  });

  it("مقدار خالی یا خراب undefined برمی‌گرداند", () => {
    expect(dateToUnixSeconds("", false)).toBeUndefined();
    expect(dateToUnixSeconds("abc", false)).toBeUndefined();
    expect(dateToUnixSeconds("2026-07", false)).toBeUndefined();
  });
});

describe("فیلتر بازه تاریخ صفحه نظرسنجی‌ها", () => {
  beforeEach(() => {
    requests = [];
    installFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("انتخاب تاریخ، from/to را به درخواست اضافه می‌کند و صفحه را به ۱ برمی‌گرداند", async () => {
    renderSurveys();
    await screen.findByText(SURVEY_PATIENT);

    // برو به صفحه ۲ تا برگشتِ page=1 پس از فیلتر قابل‌مشاهده باشد
    fireEvent.click(screen.getByTestId("button-surveys-next"));
    await waitFor(() =>
      expect(lastSurveysRequest().searchParams.get("page")).toBe("2"),
    );

    fireEvent.change(screen.getByLabelText("ابتدای بازه"), {
      target: { value: "2026-07-01" },
    });
    await waitFor(() => {
      const url = lastSurveysRequest();
      expect(url.searchParams.get("from")).toBe(
        String(Math.floor(new Date(2026, 6, 1, 0, 0, 0).getTime() / 1000)),
      );
      expect(url.searchParams.get("page")).toBe("1");
    });

    fireEvent.change(screen.getByLabelText("انتهای بازه"), {
      target: { value: "2026-07-10" },
    });
    await waitFor(() => {
      const url = lastSurveysRequest();
      expect(url.searchParams.get("to")).toBe(
        String(Math.floor(new Date(2026, 6, 10, 23, 59, 59).getTime() / 1000)),
      );
      expect(url.searchParams.get("from")).toBe(
        String(Math.floor(new Date(2026, 6, 1, 0, 0, 0).getTime() / 1000)),
      );
    });
  });

  it("نتیجه خالی در بازه، پیام مخصوص فیلتر تاریخ را نشان می‌دهد", async () => {
    renderSurveys();
    await screen.findByText(SURVEY_PATIENT);

    fireEvent.change(screen.getByLabelText("ابتدای بازه"), {
      target: { value: "2026-07-01" },
    });
    await screen.findByText("در این بازه تاریخ نظرسنجی‌ای یافت نشد");
  });

  it("دکمه «حذف فیلتر» بازه را پاک می‌کند و فهرست برمی‌گردد", async () => {
    renderSurveys();
    await screen.findByText(SURVEY_PATIENT);

    fireEvent.change(screen.getByLabelText("ابتدای بازه"), {
      target: { value: "2026-07-01" },
    });
    await screen.findByText("در این بازه تاریخ نظرسنجی‌ای یافت نشد");

    fireEvent.click(screen.getByTestId("button-clear-surveys-range"));
    await screen.findByText(SURVEY_PATIENT);
    const url = lastSurveysRequest();
    expect(url.searchParams.has("from")).toBe(false);
    expect(url.searchParams.has("to")).toBe(false);
    expect(url.searchParams.get("page")).toBe("1");
    expect(screen.queryByTestId("button-clear-surveys-range")).toBeNull();
  });
});
