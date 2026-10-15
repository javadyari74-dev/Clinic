import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

// ابزارهای پروندهٔ بیمار: ویرایش یادداشت، فیلتر یادآوری‌ها با patientId، تغییر وضعیت گروهی نوبت‌ها.

vi.mock("../src/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/lib/sms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/sms")>();
  return {
    ...actual,
    sendSms: vi.fn(async () => ({ ok: true })),
    fireCommissionSms: vi.fn(),
    firePaymentSms: vi.fn(),
    fireSurveySms: vi.fn(),
    fireAppointmentSms: vi.fn(),
  };
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../lib/db/migrations");

let dbm: typeof import("@workspace/db");
let server: http.Server;
let base: string;
let currentUser: { sub: number; role: string; username: string; permissions: string[] } = {
  sub: 999_001, role: "admin", username: "admin", permissions: [],
};

async function call(method: string, p: string, body?: unknown) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

let fileSeq = 0;
async function patient(name: string) {
  const [p] = await dbm.db.insert(dbm.patientsTable)
    .values({ name, phone: "09121234567", fileNumber: `PF${++fileSeq}` }).returning();
  return p;
}
let serviceId = 0;
async function appointment(patientId: number, extra: Record<string, unknown> = {}) {
  const r = await call("POST", "/appointments", { patientId, serviceId, scheduledAt: Date.now(), ...extra });
  expect(r.status).toBe(201);
  return r.json as { id: number; status: string };
}

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "patient-file-tools-test-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-clinic.db");
  dbm = await import("@workspace/db");
  await dbm.runMigrations(MIGRATIONS_DIR);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { jwtUser: unknown }).jwtUser = currentUser; next(); });
  for (const mod of ["payments", "appointments", "services", "patient-notes", "reminders"]) {
    const { default: r } = await import(`../src/routes/${mod}.ts`);
    app.use(r);
  }
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const svc = await call("POST", "/services", { name: "پاکسازی", price: 1_000_000 });
  expect(svc.status).toBe(201);
  serviceId = svc.json.id;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("PUT /patient-notes/:id", () => {
  it("updates content and kind, trims text", async () => {
    const p = await patient("یادداشت‌دار");
    const created = await call("POST", `/patients/${p.id}/notes`, { content: "اول", kind: "general" });
    expect(created.status).toBe(201);
    const upd = await call("PUT", `/patient-notes/${created.json.id}`, { content: "  ویرایش‌شده  ", kind: "medical" });
    expect(upd.status).toBe(200);
    expect(upd.json).toMatchObject({ id: created.json.id, content: "ویرایش‌شده", kind: "medical", patientId: p.id });
    const list = await call("GET", `/patients/${p.id}/notes`);
    expect(list.json).toHaveLength(1);
    expect(list.json[0].content).toBe("ویرایش‌شده");
  });

  it("rejects empty content and unknown notes", async () => {
    const p = await patient("یادداشت خالی");
    const created = await call("POST", `/patients/${p.id}/notes`, { content: "متن" });
    expect((await call("PUT", `/patient-notes/${created.json.id}`, { content: "   " })).status).toBe(400);
    expect((await call("PUT", `/patient-notes/${created.json.id}`, {})).status).toBe(400);
    expect((await call("PUT", `/patient-notes/987654`, { content: "x" })).status).toBe(404);
  });
});

describe("GET /reminders?patientId=", () => {
  it("returns only that patient's reminders", async () => {
    const a = await patient("الف");
    const b = await patient("ب");
    const due = Math.floor(Date.now() / 1000) + 3600;
    for (const [pid, title] of [[a.id, "پیگیری الف"], [a.id, "تماس الف"], [b.id, "پیگیری ب"]] as const) {
      expect((await call("POST", "/reminders", { title, patientId: pid, dueAt: due, type: "custom" })).status).toBe(201);
    }
    const ra = await call("GET", `/reminders?patientId=${a.id}`);
    expect(ra.status).toBe(200);
    expect(ra.json.map((r: { title: string }) => r.title).sort()).toEqual(["پیگیری الف", "تماس الف"].sort());
    expect(ra.json.every((r: { patientId: number }) => r.patientId === a.id)).toBe(true);
    const all = await call("GET", `/reminders`);
    expect(all.json.length).toBeGreaterThanOrEqual(3);
    expect((await call("GET", `/reminders?patientId=abc`)).status).toBe(400);

    // علامت انجام‌شده و ترکیب با فیلتر وضعیت
    const id = ra.json[0].id;
    expect((await call("PUT", `/reminders/${id}`, { status: "done" })).status).toBe(200);
    const pending = await call("GET", `/reminders?patientId=${a.id}&status=pending`);
    expect(pending.json).toHaveLength(1);
  });
});

describe("POST /appointments/bulk-status", () => {
  it("changes status of many appointments and logs activity", async () => {
    const p = await patient("گروهی");
    const a1 = await appointment(p.id);
    const a2 = await appointment(p.id);
    const r = await call("POST", "/appointments/bulk-status", { ids: [a1.id, a2.id], status: "confirmed" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ changed: 2, unchanged: 0, skipped: [] });
    for (const id of [a1.id, a2.id]) {
      expect((await call("GET", `/appointments/${id}`)).json.status).toBe("confirmed");
    }
    const logs = await dbm.db.select().from(dbm.activityLogTable);
    expect(logs.some((l) => l.description.includes("به‌صورت گروهی") && l.description.includes("2"))).toBe(true);

    // دوباره همان وضعیت → بدون تغییر
    const again = await call("POST", "/appointments/bulk-status", { ids: [a1.id], status: "confirmed" });
    expect(again.json).toMatchObject({ changed: 0, unchanged: 1 });

    // انجام‌شده حتی بدون پرداخت مجاز است
    const done = await call("POST", "/appointments/bulk-status", { ids: [a1.id], status: "completed" });
    expect(done.json.changed).toBe(1);
  });

  it("skips cancelling appointments that have payments, reports missing ids", async () => {
    const p = await patient("پرداخت‌دار");
    // بیعانه = یک ردیف پرداخت
    const paid = await appointment(p.id, { deposit: 300_000 });
    const free = await appointment(p.id);
    const { eq } = await import("drizzle-orm");
    const pays = await dbm.db.select().from(dbm.paymentsTable).where(eq(dbm.paymentsTable.appointmentId, paid.id));
    expect(pays.length).toBeGreaterThan(0);

    const r = await call("POST", "/appointments/bulk-status", { ids: [paid.id, free.id, 987654], status: "cancelled" });
    expect(r.status).toBe(200);
    expect(r.json.changed).toBe(1);
    expect(r.json.changedIds).toEqual([free.id]);
    const paidSkip = r.json.skipped.find((s: { id: number }) => s.id === paid.id);
    expect(paidSkip.reason).toMatch(/پرداخت/);
    expect(r.json.skipped.find((s: { id: number }) => s.id === 987654).reason).toMatch(/یافت نشد/);
    expect(r.json.message).toMatch(/لغو نشد/);
    expect((await call("GET", `/appointments/${paid.id}`)).json.status).not.toBe("cancelled");
    expect((await call("GET", `/appointments/${free.id}`)).json.status).toBe("cancelled");
  });

  it("validates the body", async () => {
    expect((await call("POST", "/appointments/bulk-status", { ids: [], status: "confirmed" })).status).toBe(400);
    expect((await call("POST", "/appointments/bulk-status", { ids: [1], status: "deleted" })).status).toBe(400);
    expect((await call("POST", "/appointments/bulk-status", { ids: ["x"], status: "confirmed" })).status).toBe(400);
  });

  it("requires the appointments permission (not just patients/payments)", async () => {
    const p = await patient("دسترسی");
    const a = await appointment(p.id);
    const [cashier] = await dbm.db.insert(dbm.usersTable)
      .values({ username: `cashier${Date.now()}`, password: "x", role: "staff", permissions: JSON.stringify(["payments"]) })
      .returning();
    const [receptionist] = await dbm.db.insert(dbm.usersTable)
      .values({ username: `recept${Date.now()}`, password: "x", role: "staff", permissions: JSON.stringify(["appointments"]) })
      .returning();
    try {
      currentUser = { sub: cashier.id, role: "staff", username: cashier.username, permissions: ["payments"] };
      expect((await call("POST", "/appointments/bulk-status", { ids: [a.id], status: "confirmed" })).status).toBe(403);
      currentUser = { sub: receptionist.id, role: "staff", username: receptionist.username, permissions: ["appointments"] };
      const ok = await call("POST", "/appointments/bulk-status", { ids: [a.id], status: "confirmed" });
      expect(ok.status).toBe(200);
      expect(ok.json.changed).toBe(1);
    } finally {
      currentUser = { sub: 999_001, role: "admin", username: "admin", permissions: [] };
    }
  });
});
