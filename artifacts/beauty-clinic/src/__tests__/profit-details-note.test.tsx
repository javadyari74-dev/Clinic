import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProfitDetailsDialog } from "@/components/profit-details-dialog";
import type { AccountingSummary } from "@/hooks/use-accounting";
import { makeMockApiFetch } from "./api-fixtures";

// یادداشت «± پرداخت/پورسانت بدون نوبت» وقتی جمع پورسانت خلاصه با جمع ریز سود فرق دارد هم باید بیاید
// (fixture ریز سود: درآمد ۱٬۲۰۰٬۰۰۰ و پورسانت ۱۲۰٬۰۰۰)
const NOTE = /پرداخت\/پورسانت بدون نوبت/;

function renderWith(summary: Partial<AccountingSummary>) {
  vi.stubGlobal("fetch", vi.fn(makeMockApiFetch("populated")));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProfitDetailsDialog
        open
        onOpenChange={() => {}}
        range={{ from: 1, to: 2 }}
        rangeLabel="مهر"
        summary={{ netProfit: 0, laserRevenue: 0, laserCommissions: 0, expenses: 0, ...summary } as AccountingSummary}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("profit details reconciliation note", () => {
  it("shows when only the commissions differ (e.g. a commission without a visit)", async () => {
    renderWith({ revenue: 1_200_000, commissions: 170_000 });
    expect(await screen.findByText(NOTE, undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it("is hidden when revenue and commissions both match", async () => {
    renderWith({ revenue: 1_200_000, commissions: 120_000 });
    await screen.findAllByText(/لیزر فول‌بادی/, undefined, { timeout: 3000 });
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });
});
