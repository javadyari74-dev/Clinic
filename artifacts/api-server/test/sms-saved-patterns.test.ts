import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

// روت‌های /sms/patterns: ذخیره/فهرست/ویرایش/حذف کدهای پترن نام‌دار در جدول sms_saved_patterns.
// روی یک پایگاه دادهٔ SQLite موقت اجرا می‌شود تا clinic.db توسعه دست نخورد.

vi.mock("../src/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/lib/activity", () => ({
  logActivity: vi.fn(async () => {}),
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../lib/db/migrations");

let dbModule: typeof import("@workspace/db");
let server: http.Server;
let base: string;

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sms-patterns-test-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-clinic.db");
  dbModule = await import("@workspace/db");
  await dbModule.runMigrations(MIGRATIONS_DIR);
  const { default: smsRouter } = await import("../src/routes/sms");

  const app = express();
  app.use(express.json());
  app.use(smsRouter);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(async () => {
  await dbModule.db.delete(dbModule.smsSavedPatternsTable);
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
    const { status, json } = await req("GET", "/sms/patterns");
    expect(status).toBe(200);
    expect(json).toEqual({ data: [] });
  });

  it("creates a named pattern (trimmed) and lists it", async () => {
    const created = await req("POST", "/sms/patterns", {
      name: "  یادآوری مراجعه ",
      bodyId: " 465123 ",
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ name: "یادآوری مراجعه", bodyId: "465123" });

    const list = await req("GET", "/sms/patterns");
    expect(list.json.data).toHaveLength(1);
    expect(list.json.data[0].id).toBe(created.json.id);
  });

  it("rejects empty name and non-numeric bodyId", async () => {
    const a = await req("POST", "/sms/patterns", { name: "  ", bodyId: "465123" });
    expect(a.status).toBe(400);
    const b = await req("POST", "/sms/patterns", { name: "تست", bodyId: "abc" });
    expect(b.status).toBe(400);
    const list = await req("GET", "/sms/patterns");
    expect(list.json.data).toHaveLength(0);
  });

  it("lists newest first", async () => {
    await req("POST", "/sms/patterns", { name: "الف", bodyId: "1" });
    await req("POST", "/sms/patterns", { name: "ب", bodyId: "2" });
    const list = await req("GET", "/sms/patterns");
    expect(list.json.data.map((p: { name: string }) => p.name)).toEqual(["ب", "الف"]);
  });

  it("updates a pattern and validates the input", async () => {
    const created = await req("POST", "/sms/patterns", { name: "الف", bodyId: "1" });
    const updated = await req("PUT", `/sms/patterns/${created.json.id}`, { name: "الف۲", bodyId: "22" });
    expect(updated.status).toBe(200);
    expect(updated.json).toMatchObject({ id: created.json.id, name: "الف۲", bodyId: "22" });

    const bad = await req("PUT", `/sms/patterns/${created.json.id}`, { name: "الف", bodyId: "x" });
    expect(bad.status).toBe(400);
  });

  it("deletes by id", async () => {
    const first = await req("POST", "/sms/patterns", { name: "الف", bodyId: "1" });
    await req("POST", "/sms/patterns", { name: "ب", bodyId: "2" });

    const del = await req("DELETE", `/sms/patterns/${first.json.id}`);
    expect(del.status).toBe(204);
    const list = await req("GET", "/sms/patterns");
    expect(list.json.data).toHaveLength(1);
    expect(list.json.data[0].name).toBe("ب");
  });

  it("returns 404 when updating or deleting a missing id", async () => {
    const del = await req("DELETE", "/sms/patterns/99");
    expect(del.status).toBe(404);
    const put = await req("PUT", "/sms/patterns/99", { name: "x", bodyId: "1" });
    expect(put.status).toBe(404);
  });
});
