import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// روت /sms/send-pattern: اعتبارسنجی ورودی و فراخوانی sendSms با پترن دلخواه.
// db و ماژول sms را استاب می‌کنیم تا بدون SQLite و بدون تماس واقعی با
// ملی‌پیامک تست شود.
const { state, chain } = vi.hoisted(() => {
  const state = {
    selectResults: [] as unknown[][],
    sendSmsCalls: [] as unknown[],
    sendSmsResult: { ok: true } as { ok: boolean; error?: string },
  };
  function chain(result: () => unknown) {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "leftJoin", "where", "orderBy", "values", "set", "returning"]) {
      c[m] = () => c;
    }
    (c as { then: unknown }).then = (
      res: (v: unknown) => unknown,
      rej: (e: unknown) => unknown,
    ) => Promise.resolve().then(result).then(res, rej);
    return c;
  }
  return { state, chain };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: () => chain(() => state.selectResults.shift() ?? []),
    insert: () => chain(() => []),
  },
  smsLogTable: {},
  patientsTable: { id: "id", name: "name", phone: "phone" },
}));

vi.mock("../src/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/lib/activity", () => ({
  logActivity: vi.fn(async () => {}),
}));

vi.mock("../src/lib/birthdays", () => ({
  getUpcomingBirthdays: vi.fn(async () => []),
}));

vi.mock("../src/lib/sms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/sms")>();
  return {
    ...actual,
    getSmsSettings: vi.fn(async () => ({})),
    getSmsTemplates: vi.fn(async () => ({})),
    getPanelCredit: vi.fn(async () => ({ ok: true })),
    sendSms: vi.fn(async (input: unknown) => {
      state.sendSmsCalls.push(input);
      return state.sendSmsResult;
    }),
  };
});

import smsRouter from "../src/routes/sms";

let server: http.Server;
let base: string;

beforeEach(async () => {
  state.selectResults = [];
  state.sendSmsCalls = [];
  state.sendSmsResult = { ok: true };
  const app = express();
  app.use(express.json());
  app.use(smsRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function post(body: unknown) {
  const res = await fetch(`${base}/sms/send-pattern`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("POST /sms/send-pattern", () => {
  it("rejects non-numeric bodyId", async () => {
    const { status, json } = await post({ bodyId: "abc", phone: "09123456789" });
    expect(status).toBe(400);
    expect(String(json.error)).toContain("کد پترن");
    expect(state.sendSmsCalls).toHaveLength(0);
  });

  it("rejects when no recipient is given", async () => {
    const { status, json } = await post({ bodyId: "465123" });
    expect(status).toBe(400);
    expect(String(json.error)).toContain("گیرنده");
  });

  it("rejects an invalid free-form phone number", async () => {
    const { status, json } = await post({ bodyId: "465123", phone: "12345" });
    expect(status).toBe(400);
    expect(String(json.error)).toContain("شماره موبایل");
  });

  it("rejects an unknown patientId", async () => {
    state.selectResults = [[]];
    const { status, json } = await post({ bodyId: "465123", patientId: 999 });
    expect(status).toBe(400);
    expect(String(json.error)).toContain("مراجع");
  });

  it("sends a pattern SMS to a free-form phone number without a patient", async () => {
    const { status, json } = await post({
      bodyId: "465123",
      phone: "09123456789",
      args: ["مریم"],
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(state.sendSmsCalls).toHaveLength(1);
    const call = state.sendSmsCalls[0] as Record<string, unknown>;
    expect(call.to).toBe("09123456789");
    expect(call.eventType).toBe("manual");
    expect(call.patientId).toBeNull();
    expect(call.pattern).toEqual({ bodyId: "465123", args: ["مریم"] });
  });

  it("sends to a selected patient using their stored phone and name", async () => {
    state.selectResults = [[{ id: 7, name: "سارا", phone: "09351112233" }]];
    const { status, json } = await post({ bodyId: "465123", patientId: 7, args: ["سارا"] });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    const call = state.sendSmsCalls[0] as Record<string, unknown>;
    expect(call.to).toBe("09351112233");
    expect(call.recipientName).toBe("سارا");
    expect(call.patientId).toBe(7);
  });

  it("surfaces the Persian panel error when sending fails", async () => {
    state.sendSmsResult = { ok: false, error: "اعتبار پنل پیامکی کافی نیست" };
    const { status, json } = await post({ bodyId: "465123", phone: "09123456789" });
    expect(status).toBe(200);
    expect(json.ok).toBe(false);
    expect(json.error).toBe("اعتبار پنل پیامکی کافی نیست");
  });

  it("drops empty args and trims values", async () => {
    const { status } = await post({
      bodyId: " 465123 ",
      phone: "09123456789",
      args: [" مریم ", "", "  "],
    });
    expect(status).toBe(200);
    const call = state.sendSmsCalls[0] as Record<string, unknown>;
    expect(call.pattern).toEqual({ bodyId: "465123", args: ["مریم"] });
  });
});
