import { beforeEach, describe, expect, it, vi } from "vitest";

// مثل survey-throttle: برای اثبات درست‌کارکردن منطق امتیاز (کسب/خرج/برگردان)
// روی یک SQLite واقعیِ در حافظه تست می‌کنیم. schema واقعی از @workspace/db/schema
// می‌آید (import مستقیم index.ts ممنوع است چون همان لحظه clinic.db را باز می‌کند).
vi.mock("@workspace/db", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schema = await import("@workspace/db/schema");
  const client = createClient({ url: ":memory:" });
  // همان DDL مهاجرت 0017
  await client.execute(`CREATE TABLE loyalty_transactions (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    uuid text NOT NULL,
    patient_id integer NOT NULL,
    payment_id integer,
    delta integer NOT NULL,
    amount integer DEFAULT 0 NOT NULL,
    type text NOT NULL,
    description text,
    created_at integer DEFAULT 0 NOT NULL
  )`);
  await client.execute(`CREATE UNIQUE INDEX loyalty_transactions_uuid_unique ON loyalty_transactions (uuid)`);
  await client.execute(`CREATE TABLE app_settings (
    key text PRIMARY KEY NOT NULL,
    value text,
    updated_at integer DEFAULT 0 NOT NULL
  )`);
  return { ...schema, db: drizzle(client, { schema }) };
});

import {
  computeEarnPoints,
  getLoyaltyBalance,
  applyLoyaltyOnPayment,
  reverseLoyaltyForPayment,
  getLoyaltySettings,
  LOYALTY_ERRORS,
  type LoyaltySettings,
} from "../src/lib/loyalty";
import { db, loyaltyTransactionsTable, appSettingsTable } from "@workspace/db";

const SETTINGS: LoyaltySettings = {
  enabled: true,
  earnAmount: 100_000,
  redeemValue: 10_000,
  minRedeem: 10,
};

describe("باشگاه مشتریان (loyalty)", () => {
  beforeEach(async () => {
    await db.delete(loyaltyTransactionsTable);
    await db.delete(appSettingsTable);
  });

  it("computeEarnPoints: گرد به پایین و ورودی نامعتبر", () => {
    expect(computeEarnPoints(250_000, 100_000)).toBe(2);
    expect(computeEarnPoints(99_999, 100_000)).toBe(0);
    expect(computeEarnPoints(0, 100_000)).toBe(0);
    expect(computeEarnPoints(100_000, 0)).toBe(0);
  });

  it("getLoyaltySettings: پیش‌فرض خاموش و مقادیر پیش‌فرض", async () => {
    const s = await getLoyaltySettings();
    expect(s.enabled).toBe(false);
    expect(s.earnAmount).toBe(100_000);
    expect(s.redeemValue).toBe(10_000);
    expect(s.minRedeem).toBe(10);
  });

  it("getLoyaltySettings: مقادیر ذخیره‌شده و نامعتبرها clamp می‌شوند", async () => {
    await db.insert(appSettingsTable).values([
      { key: "loyalty_enabled", value: "true" },
      { key: "loyalty_earn_amount", value: "50000" },
      { key: "loyalty_redeem_value", value: "abc" },
      { key: "loyalty_min_redeem", value: "0" },
    ]);
    const s = await getLoyaltySettings();
    expect(s.enabled).toBe(true);
    expect(s.earnAmount).toBe(50_000);
    expect(s.redeemValue).toBe(10_000); // نامعتبر → پیش‌فرض
    expect(s.minRedeem).toBe(10); // کمتر از حداقل → پیش‌فرض
  });

  it("کسب: پرداخت ۲۵۰هزار با نرخ ۱۰۰هزار = ۲ امتیاز", async () => {
    const res = await applyLoyaltyOnPayment(db, {
      patientId: 1, paymentId: 10, amountPaid: 250_000, redeemPoints: 0, settings: SETTINGS,
    });
    expect(res.earned).toBe(2);
    expect(await getLoyaltyBalance(db, 1)).toBe(2);
  });

  it("باشگاه خاموش: نه کسب می‌شود و نه خرجِ امتیاز مجاز است", async () => {
    const res = await applyLoyaltyOnPayment(db, {
      patientId: 1, paymentId: 10, amountPaid: 500_000, redeemPoints: 0,
      settings: { ...SETTINGS, enabled: false },
    });
    expect(res.earned).toBe(0);
    await expect(
      applyLoyaltyOnPayment(db, {
        patientId: 1, paymentId: 11, amountPaid: 0, redeemPoints: 10,
        settings: { ...SETTINGS, enabled: false },
      }),
    ).rejects.toThrow(LOYALTY_ERRORS.disabled);
  });

  it("خرج کمتر از حداقل رد می‌شود", async () => {
    await expect(
      applyLoyaltyOnPayment(db, {
        patientId: 1, paymentId: 10, amountPaid: 0, redeemPoints: 5, settings: SETTINGS,
      }),
    ).rejects.toThrow(LOYALTY_ERRORS.minRedeem);
  });

  it("خرج بیش از موجودی رد می‌شود", async () => {
    // موجودی ۲ امتیاز
    await applyLoyaltyOnPayment(db, {
      patientId: 1, paymentId: 10, amountPaid: 250_000, redeemPoints: 0, settings: SETTINGS,
    });
    await expect(
      applyLoyaltyOnPayment(db, {
        patientId: 1, paymentId: 11, amountPaid: 0, redeemPoints: 10, settings: SETTINGS,
      }),
    ).rejects.toThrow(LOYALTY_ERRORS.insufficient);
  });

  it("خرج معتبر: دلتای منفی و ارزش تومانی درست + کسبِ همان پرداخت", async () => {
    // موجودی ۱۵ امتیاز
    await applyLoyaltyOnPayment(db, {
      patientId: 1, paymentId: 10, amountPaid: 1_500_000, redeemPoints: 0, settings: SETTINGS,
    });
    const res = await applyLoyaltyOnPayment(db, {
      patientId: 1, paymentId: 11, amountPaid: 200_000, redeemPoints: 10, settings: SETTINGS,
    });
    expect(res.redeemed).toBe(10);
    expect(res.redeemedValue).toBe(100_000);
    expect(res.earned).toBe(2); // از مبلغ نقدی همین پرداخت
    expect(await getLoyaltyBalance(db, 1)).toBe(15 - 10 + 2);
    const rows = await db.select().from(loyaltyTransactionsTable);
    const redeemRow = rows.find((r) => r.type === "redeem");
    expect(redeemRow?.delta).toBe(-10);
    expect(redeemRow?.amount).toBe(100_000);
  });

  it("حذف پرداخت: کسب و خرج هر دو با ردیف reverse برگردانده می‌شوند", async () => {
    await applyLoyaltyOnPayment(db, {
      patientId: 1, paymentId: 10, amountPaid: 1_500_000, redeemPoints: 0, settings: SETTINGS,
    }); // +15
    await applyLoyaltyOnPayment(db, {
      patientId: 1, paymentId: 11, amountPaid: 0, redeemPoints: 10, settings: SETTINGS,
    }); // -10 → موجودی 5
    const reversed = await reverseLoyaltyForPayment(db, 11);
    expect(reversed).toBe(1);
    expect(await getLoyaltyBalance(db, 1)).toBe(15); // خرج برگشت
    const reverseRows = (await db.select().from(loyaltyTransactionsTable)).filter((r) => r.type === "reverse");
    expect(reverseRows).toHaveLength(1);
    expect(reverseRows[0].delta).toBe(10);
  });

  it("حذف پرداختی که امتیازش خرج شده و موجودی منفی می‌شود، بلاک می‌شود", async () => {
    await applyLoyaltyOnPayment(db, {
      patientId: 1, paymentId: 10, amountPaid: 1_000_000, redeemPoints: 0, settings: SETTINGS,
    }); // +10
    await applyLoyaltyOnPayment(db, {
      patientId: 1, paymentId: 11, amountPaid: 0, redeemPoints: 10, settings: SETTINGS,
    }); // -10 → موجودی 0
    await expect(reverseLoyaltyForPayment(db, 10)).rejects.toThrow(LOYALTY_ERRORS.negativeOnDelete);
  });

  it("حذف پرداخت بدون تراکنش امتیازی: بدون اثر", async () => {
    expect(await reverseLoyaltyForPayment(db, 999)).toBe(0);
  });
});
