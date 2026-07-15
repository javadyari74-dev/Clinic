import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// The surveys routes read/write through drizzle's fluent query builder.
// Stub @workspace/db with a chainable, awaitable mock so each test can queue
// the rows a query should resolve to without a real SQLite database.
const { state, chain } = vi.hoisted(() => {
  const state = {
    selectResults: [] as unknown[][],
    updateResult: [] as unknown[],
    deleteResult: [] as unknown[],
  };
  function chain(result: () => unknown) {
    const c: Record<string, unknown> = {};
    for (const m of [
      "from", "leftJoin", "where", "orderBy", "limit", "offset", "groupBy",
      "values", "set", "returning",
    ]) {
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
    update: () => chain(() => state.updateResult),
    delete: () => chain(() => state.deleteResult),
  },
  surveysTable: {},
  patientsTable: {},
  servicesTable: {},
  staffTable: {},
  appointmentsTable: {},
  appSettingsTable: {},
  smsLogTable: {},
}));

// eq/desc/sql would otherwise choke on the empty mock tables above.
vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  desc: () => ({}),
  and: () => ({}),
  gte: () => ({}),
  lte: () => ({}),
  isNull: () => ({}),
  isNotNull: () => ({}),
  inArray: () => ({}),
  sql: () => ({}),
}));

const { logActivityMock } = vi.hoisted(() => ({
  logActivityMock: vi.fn(() => Promise.resolve()),
}));
vi.mock("../src/lib/activity", () => ({ logActivity: logActivityMock }));

const sampleSurvey = {
  id: 4,
  patientId: 3,
  appointmentId: 11,
  paymentId: 22,
  serviceId: 5,
  staffId: 2,
  sentAt: 1_783_800_000,
  smsStatus: "sent",
  score: null,
  comment: null,
  scoredAt: null,
  createdAt: 1_783_800_000,
  patientName: "مریم رضایی",
  patientPhone: "09121112233",
  patientFileNumber: "101",
  serviceName: "لیزر",
  staffName: "الهام",
};

let server: http.Server | undefined;
let baseUrl = "";

beforeEach(async () => {
  state.selectResults = [];
  state.updateResult = [];
  state.deleteResult = [];
  logActivityMock.mockClear();

  const { default: surveysRouter } = await import("../src/routes/surveys");
  const app = express();
  app.use(express.json());
  app.use(surveysRouter);
  server = await new Promise<http.Server>((resolve) => {
    const s = http.createServer(app);
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  if (server) {
    const s = server;
    server = undefined;
    await new Promise<void>((resolve, reject) => s.close((e) => (e ? reject(e) : resolve())));
  }
});

async function request(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: res.status, json };
}

describe("GET /surveys", () => {
  it("returns rows with joined details plus total", async () => {
    state.selectResults = [[sampleSurvey], [{ count: 1 }]];
    const res = await request("GET", "/surveys?status=pending");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ data: [sampleSurvey], total: 1 });
  });

  it("rejects an unknown status value", async () => {
    const res = await request("GET", "/surveys?status=bogus");
    expect(res.status).toBe(400);
  });
});

describe("GET /surveys/stats", () => {
  it("aggregates totals and per-service/per-staff averages sorted by average", async () => {
    state.selectResults = [
      [{ count: 5 }],
      [{ count: 3, avg: 4.0 }],
      [
        { id: 5, name: "لیزر", count: 2, avg: 3.5 },
        { id: null, name: null, count: 1, avg: 5 },
      ],
      [{ id: 2, name: "الهام", count: 3, avg: 4.0 }],
    ];
    const res = await request("GET", "/surveys/stats");
    expect(res.status).toBe(200);
    expect(res.json.total).toBe(5);
    expect(res.json.scoredCount).toBe(3);
    expect(res.json.avgScore).toBe(4.0);
    // مرتب‌سازی نزولی بر اساس میانگین + برچسب «نامشخص» برای مرجع حذف‌شده
    expect(res.json.byService).toEqual([
      { id: null, name: "نامشخص", count: 1, avgScore: 5 },
      { id: 5, name: "لیزر", count: 2, avgScore: 3.5 },
    ]);
    expect(res.json.byStaff).toEqual([
      { id: 2, name: "الهام", count: 3, avgScore: 4.0 },
    ]);
  });

  it("returns a null average when nothing is scored yet", async () => {
    state.selectResults = [[{ count: 2 }], [{ count: 0, avg: null }], [], []];
    const res = await request("GET", "/surveys/stats");
    expect(res.status).toBe(200);
    expect(res.json.avgScore).toBeNull();
    expect(res.json.scoredCount).toBe(0);
  });
});

describe("PUT /surveys/:id", () => {
  it("rejects an out-of-range score", async () => {
    expect((await request("PUT", "/surveys/4", { score: 0 })).status).toBe(400);
    expect((await request("PUT", "/surveys/4", { score: 6 })).status).toBe(400);
  });

  it("rejects a non-integer score", async () => {
    const res = await request("PUT", "/surveys/4", { score: 3.5 });
    expect(res.status).toBe(400);
  });

  it("404s when the survey does not exist", async () => {
    state.updateResult = [];
    const res = await request("PUT", "/surveys/999", { score: 4 });
    expect(res.status).toBe(404);
  });

  it("stores the score with a trimmed comment and logs activity", async () => {
    state.updateResult = [{ id: 4 }];
    state.selectResults = [[{ ...sampleSurvey, score: 4, comment: "راضی بود", scoredAt: 1_783_900_000 }]];
    const res = await request("PUT", "/surveys/4", { score: 4, comment: "  راضی بود  " });
    expect(res.status).toBe(200);
    expect(res.json.score).toBe(4);
    expect(res.json.comment).toBe("راضی بود");
    expect(logActivityMock).toHaveBeenCalledWith(
      "update",
      "survey",
      4,
      expect.stringContaining("مریم رضایی"),
    );
  });
});

describe("DELETE /surveys/:id", () => {
  it("deletes an existing survey with 204 and 404s otherwise", async () => {
    state.deleteResult = [{ id: 4 }];
    expect((await request("DELETE", "/surveys/4")).status).toBe(204);
    state.deleteResult = [];
    expect((await request("DELETE", "/surveys/4")).status).toBe(404);
  });
});

// ── محدودیت تکرار نظرسنجی (توابع خالص lib/sms) ───────────────────────────────

describe("isSurveyThrottled", () => {
  it("never throttles a patient with no prior survey", async () => {
    const { isSurveyThrottled } = await import("../src/lib/sms");
    expect(isSurveyThrottled(null, 1_000_000, 30)).toBe(false);
    expect(isSurveyThrottled(undefined, 1_000_000, 30)).toBe(false);
  });

  it("never throttles when the window is zero days", async () => {
    const { isSurveyThrottled } = await import("../src/lib/sms");
    expect(isSurveyThrottled(999_999, 1_000_000, 0)).toBe(false);
  });

  it("throttles inside the window and releases after it passes", async () => {
    const { isSurveyThrottled } = await import("../src/lib/sms");
    const now = 2_000_000;
    const thirtyDays = 30 * 86_400;
    expect(isSurveyThrottled(now - thirtyDays + 1, now, 30)).toBe(true);
    expect(isSurveyThrottled(now - thirtyDays - 1, now, 30)).toBe(false);
  });
});

describe("clampSurveyThrottleDays", () => {
  it("defaults to 30 for garbage and clamps to 0..365", async () => {
    const { clampSurveyThrottleDays } = await import("../src/lib/sms");
    expect(clampSurveyThrottleDays(null)).toBe(30);
    expect(clampSurveyThrottleDays("abc")).toBe(30);
    expect(clampSurveyThrottleDays(-5)).toBe(0);
    expect(clampSurveyThrottleDays(9999)).toBe(365);
    expect(clampSurveyThrottleDays("14")).toBe(14);
  });
});
