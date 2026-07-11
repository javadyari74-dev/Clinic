import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// The waiting-list routes read/write through drizzle's fluent query builder.
// Stub @workspace/db with a chainable, awaitable mock so each test can queue
// the rows a query should resolve to without a real SQLite database.
const { state, chain } = vi.hoisted(() => {
  const state = {
    selectResults: [] as unknown[][],
    insertResult: [] as unknown[],
    updateResult: [] as unknown[],
    deleteResult: [] as unknown[],
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
    insert: () => chain(() => state.insertResult),
    update: () => chain(() => state.updateResult),
    delete: () => chain(() => state.deleteResult),
  },
  waitingListTable: {},
  patientsTable: {},
  servicesTable: {},
}));

// eq/desc/sql would otherwise choke on the empty mock tables above.
vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  desc: () => ({}),
  sql: () => ({}),
}));

const { sendSmsMock, logActivityMock } = vi.hoisted(() => ({
  sendSmsMock: vi.fn(),
  logActivityMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("../src/lib/sms", () => ({
  sendSms: sendSmsMock,
  formatShamsiDateForSms: (ts: number) => `shamsi(${ts})`,
}));
vi.mock("../src/lib/activity", () => ({ logActivity: logActivityMock }));

const sampleEntry = {
  id: 7,
  patientId: 3,
  serviceId: 5,
  preferredFrom: 1_783_900_000,
  preferredTo: null,
  note: "فقط بعدازظهر",
  status: "waiting",
  appointmentId: null,
  createdAt: 1_783_800_000,
  patientName: "مریم رضایی",
  patientPhone: "09121112233",
  patientFileNumber: "101",
  patientTier: null,
  serviceName: "لیزر",
};

let server: http.Server | undefined;
let baseUrl = "";

beforeEach(async () => {
  state.selectResults = [];
  state.insertResult = [];
  state.updateResult = [];
  state.deleteResult = [];
  sendSmsMock.mockReset();
  logActivityMock.mockClear();

  const { default: waitingListRouter } = await import("../src/routes/waiting-list");
  const app = express();
  app.use(express.json());
  app.use(waitingListRouter);
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
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}

describe("GET /waiting-list", () => {
  it("returns rows with patient/service details plus total", async () => {
    state.selectResults = [[sampleEntry], [{ count: 1 }]];
    const res = await request("GET", "/waiting-list?status=waiting");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ data: [sampleEntry], total: 1 });
  });
});

describe("POST /waiting-list", () => {
  it("rejects a body without patientId/serviceId", async () => {
    const res = await request("POST", "/waiting-list", { note: "بدون مراجع" });
    expect(res.status).toBe(400);
  });

  it("creates an entry, logs activity and returns the joined detail", async () => {
    state.insertResult = [{ id: 7 }];
    state.selectResults = [[sampleEntry]];
    const res = await request("POST", "/waiting-list", { patientId: 3, serviceId: 5 });
    expect(res.status).toBe(201);
    expect(res.json).toEqual(sampleEntry);
    expect(logActivityMock).toHaveBeenCalledWith(
      "create",
      "waiting_list",
      7,
      expect.stringContaining("مریم رضایی"),
    );
  });
});

describe("PUT /waiting-list/:id", () => {
  it("rejects an unknown status value", async () => {
    const res = await request("PUT", "/waiting-list/7", { status: "bogus" });
    expect(res.status).toBe(400);
  });

  it("404s when the entry does not exist", async () => {
    state.updateResult = [];
    const res = await request("PUT", "/waiting-list/999", { note: "x" });
    expect(res.status).toBe(404);
  });

  it("updates and returns the joined detail", async () => {
    state.updateResult = [{ id: 7 }];
    state.selectResults = [[{ ...sampleEntry, status: "fulfilled", appointmentId: 42 }]];
    const res = await request("PUT", "/waiting-list/7", { status: "fulfilled", appointmentId: 42 });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe("fulfilled");
    expect(res.json.appointmentId).toBe(42);
  });
});

describe("DELETE /waiting-list/:id", () => {
  it("deletes an existing entry with 204 and 404s otherwise", async () => {
    state.deleteResult = [{ id: 7 }];
    expect((await request("DELETE", "/waiting-list/7")).status).toBe(204);
    state.deleteResult = [];
    expect((await request("DELETE", "/waiting-list/7")).status).toBe(404);
  });
});

describe("POST /waiting-list/:id/notify", () => {
  it("404s when the entry does not exist", async () => {
    state.selectResults = [[]];
    const res = await request("POST", "/waiting-list/999/notify");
    expect(res.status).toBe(404);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it("sends a free-text vacancy SMS to the patient and reports success", async () => {
    state.selectResults = [[sampleEntry]];
    sendSmsMock.mockResolvedValue({ ok: true });
    const res = await request("POST", "/waiting-list/7/notify");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, error: null });
    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    const arg = sendSmsMock.mock.calls[0][0];
    expect(arg.to).toBe("09121112233");
    expect(arg.eventType).toBe("waiting_list");
    expect(arg.patientId).toBe(3);
    expect(arg.text).toContain("مریم رضایی");
    expect(arg.text).toContain("جای خالی");
    // بدون کد پترن: متن آزاد باید از خط عادی برود
    expect(arg.bodyId).toBeUndefined();
    expect(logActivityMock).toHaveBeenCalledWith(
      "create",
      "sms",
      7,
      expect.stringContaining("مریم رضایی"),
    );
  });

  it("surfaces a failed send as ok:false with the error text", async () => {
    state.selectResults = [[sampleEntry]];
    sendSmsMock.mockResolvedValue({ ok: false, error: "عدم دسترسی به اینترنت یا پنل پیامکی" });
    const res = await request("POST", "/waiting-list/7/notify");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: false, error: "عدم دسترسی به اینترنت یا پنل پیامکی" });
    expect(logActivityMock).not.toHaveBeenCalled();
  });
});
