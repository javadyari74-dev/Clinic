import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// روت‌های /sms/saved-patterns: ذخیره/فهرست/حذف کدهای پترن نام‌دار.
// app_settings را با یک Map در حافظه استاب می‌کنیم.
const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock("@workspace/db", () => ({
  db: {},
  smsLogTable: {},
  patientsTable: {},
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
    sendSms: vi.fn(async () => ({ ok: true })),
    getSavedPatterns: vi.fn(async () => {
      const raw = store.get("sms_saved_patterns");
      return raw ? JSON.parse(raw) : [];
    }),
    setSavedPatterns: vi.fn(async (patterns: unknown) => {
      store.set("sms_saved_patterns", JSON.stringify(patterns));
    }),
  };
});

import smsRouter from "../src/routes/sms";

let server: http.Server;
let base: string;

beforeEach(async () => {
  store.clear();
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

async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

describe("saved patterns CRUD", () => {
  it("starts empty", async () => {
    const { status, json } = await req("GET", "/sms/saved-patterns");
    expect(status).toBe(200);
    expect(json).toEqual([]);
  });

  it("creates a named pattern and lists it", async () => {
    const created = await req("POST", "/sms/saved-patterns", {
      name: "یادآوری مراجعه",
      bodyId: "465123",
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ id: 1, name: "یادآوری مراجعه", bodyId: "465123" });

    const list = await req("GET", "/sms/saved-patterns");
    expect(list.json).toHaveLength(1);
  });

  it("rejects empty name and non-numeric bodyId", async () => {
    const a = await req("POST", "/sms/saved-patterns", { name: "  ", bodyId: "465123" });
    expect(a.status).toBe(400);
    const b = await req("POST", "/sms/saved-patterns", { name: "تست", bodyId: "abc" });
    expect(b.status).toBe(400);
  });

  it("rejects duplicate names", async () => {
    await req("POST", "/sms/saved-patterns", { name: "یادآوری", bodyId: "1" });
    const dup = await req("POST", "/sms/saved-patterns", { name: "یادآوری", bodyId: "2" });
    expect(dup.status).toBe(400);
    expect(String(dup.json.error)).toContain("قبلاً");
  });

  it("assigns increasing ids and deletes by id", async () => {
    await req("POST", "/sms/saved-patterns", { name: "الف", bodyId: "1" });
    const second = await req("POST", "/sms/saved-patterns", { name: "ب", bodyId: "2" });
    expect(second.json.id).toBe(2);

    const del = await req("DELETE", "/sms/saved-patterns/1");
    expect(del.status).toBe(204);
    const list = await req("GET", "/sms/saved-patterns");
    expect(list.json).toHaveLength(1);
    expect(list.json[0].name).toBe("ب");
  });

  it("returns 404 when deleting a missing id", async () => {
    const del = await req("DELETE", "/sms/saved-patterns/99");
    expect(del.status).toBe(404);
  });
});
