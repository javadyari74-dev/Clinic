import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

// رفع اشکال‌های عملیاتی: نوبت‌ها، لیست انتظار، مراجعین، خدمات، لیزر، پیامک، فعالیت، کاربران، یادآوری‌ها.

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

type JwtUser = { sub: number; role: string; username: string; permissions: string[] };
let dbm: typeof import("@workspace/db");
let server: http.Server;
let base: string;
let admin: JwtUser;
let currentUser: JwtUser;

async function call(method: string, p: string, body?: unknown) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, text };
}

let seq = 0;
async function patient(name = "مراجع", extra: Record<string, unknown> = {}) {
  const [p] = await dbm.db.insert(dbm.patientsTable)
    .values({ name, phone: "09121234567", fileNumber: `OF${++seq}`, ...extra }).returning();
  return p;
}
async function service(name = `خدمت ${++seq}`) {
  const r = await call("POST", "/services", { name, price: 1_000_000 });
  expect(r.status).toBe(201);
  return r.json as { id: number };
}
let defaultServiceId = 0;
async function appointment(patientId: number, extra: Record<string, unknown> = {}) {
  const r = await call("POST", "/appointments", { patientId, serviceId: defaultServiceId, scheduledAt: Date.now(), ...extra });
  expect(r.status).toBe(201);
  return r.json as { id: number; status: string; sessionNumber: number; serviceId: number; patientId: number };
}
async function user(role: string, permissions: string[]) {
  const [u] = await dbm.db.insert(dbm.usersTable)
    .values({ username: `u${++seq}_${Date.now()}`, password: "x", role: role as "staff", permissions: JSON.stringify(permissions) })
    .returning();
  return u;
}
async function as<T>(u: JwtUser, fn: () => Promise<T>): Promise<T> {
  const prev = currentUser;
  currentUser = u;
  try { return await fn(); } finally { currentUser = prev; }
}

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-fixes-test-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-clinic.db");
  dbm = await import("@workspace/db");
  await dbm.runMigrations(MIGRATIONS_DIR);

  const [a] = await dbm.db.insert(dbm.usersTable)
    .values({ username: "opsadmin", password: "x", role: "admin", permissions: "[]" }).returning();
  admin = { sub: a.id, role: "admin", username: "opsadmin", permissions: [] };
  currentUser = admin;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as unknown as { jwtUser: unknown }).jwtUser = currentUser; next(); });
  for (const mod of ["appointments", "services", "patients", "waiting-list", "laser", "sms", "activity", "auth", "reminders"]) {
    const { default: r } = await import(`../src/routes/${mod}.ts`);
    app.use(r);
  }
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  defaultServiceId = (await service("پاکسازی")).id;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const paymentsOf = async (appointmentId: number) =>
  (await dbm.db.select().from(dbm.paymentsTable).all()).filter((p) => p.appointmentId === appointmentId);
const apptRow = async (id: number) =>
  (await dbm.db.select().from(dbm.appointmentsTable).all()).find((a) => a.id === id);

describe("PUT /appointments/:id — guards (bugs 1-3)", () => {
  it("refuses to cancel an appointment that has payments (same message as bulk-status)", async () => {
    const p = await patient();
    const a = await appointment(p.id, { deposit: 200_000 });
    expect(await paymentsOf(a.id)).toHaveLength(1);
    const r = await call("PUT", `/appointments/${a.id}`, { status: "cancelled" });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("لغو نمی‌شود");
    expect((await apptRow(a.id))?.status).toBe("scheduled");
    // نوبت بدون پرداخت لغو می‌شود
    const b = await appointment(p.id);
    expect((await call("PUT", `/appointments/${b.id}`, { status: "cancelled" })).status).toBe(200);
  });

  it("payments-only users may only mark completed (role read from DB)", async () => {
    const p = await patient();
    const a = await appointment(p.id);
    const cashier = await user("staff", ["payments"]);
    const cashierJwt = { sub: cashier.id, role: "staff", username: cashier.username, permissions: ["payments"] };
    await as(cashierJwt, async () => {
      expect((await call("PUT", `/appointments/${a.id}`, { status: "confirmed" })).status).toBe(403);
      expect((await call("PUT", `/appointments/${a.id}`, { notes: "x" })).status).toBe(403);
      expect((await call("PUT", `/appointments/${a.id}`, { status: "completed", scheduledAt: Date.now() })).status).toBe(403);
      const ok = await call("PUT", `/appointments/${a.id}`, { status: "completed" });
      expect(ok.status).toBe(200);
      expect(ok.json.status).toBe("completed");
    });
    // توکن کهنه‌ای که هنوز «admin» می‌گوید، ولی نقش در پایگاه داده staff است
    await as({ ...cashierJwt, role: "admin" }, async () => {
      expect((await call("PUT", `/appointments/${a.id}`, { status: "scheduled" })).status).toBe(403);
    });
    const recept = await user("staff", ["appointments"]);
    await as({ sub: recept.id, role: "staff", username: recept.username, permissions: ["appointments"] }, async () => {
      expect((await call("PUT", `/appointments/${a.id}`, { status: "confirmed", notes: "ok" })).status).toBe(200);
    });
  });

  it("validates status values and refuses patient/service change on paid appointments", async () => {
    const p = await patient();
    const a = await appointment(p.id);
    expect((await call("PUT", `/appointments/${a.id}`, { status: "bogus" })).status).toBe(400);
    expect((await call("POST", "/appointments", { patientId: p.id, serviceId: defaultServiceId, scheduledAt: Date.now(), status: "bogus" })).status).toBe(400);
    expect((await call("PUT", `/appointments/${a.id}`, { status: "no_show" })).status).toBe(200);

    const other = await service();
    const p2 = await patient();
    const paid = await appointment(p.id, { deposit: 100_000 });
    const s1 = await call("PUT", `/appointments/${paid.id}`, { serviceId: other.id });
    expect(s1.status).toBe(400);
    expect(s1.json.error).toContain("پرداخت");
    expect((await call("PUT", `/appointments/${paid.id}`, { patientId: p2.id })).status).toBe(400);
    // همان مقدار فعلی ایراد ندارد
    expect((await call("PUT", `/appointments/${paid.id}`, { patientId: p.id, serviceId: defaultServiceId, notes: "n" })).status).toBe(200);
    // نوبت بدون پرداخت: خدمت عوض می‌شود، ولی خدمت/مراجع ناموجود رد می‌شود
    expect((await call("PUT", `/appointments/${a.id}`, { serviceId: other.id })).status).toBe(200);
    expect((await call("PUT", `/appointments/${a.id}`, { serviceId: 987_654 })).status).toBe(400);
    expect((await call("PUT", `/appointments/${a.id}`, { patientId: 987_654 })).status).toBe(400);
  });
});

describe("existence checks on create (bug 4)", () => {
  it("POST /appointments rejects unknown patient or service", async () => {
    const p = await patient();
    const r1 = await call("POST", "/appointments", { patientId: 987_654, serviceId: defaultServiceId, scheduledAt: Date.now() });
    expect(r1.status).toBe(400);
    expect(r1.json.error).toContain("مراجع");
    const r2 = await call("POST", "/appointments", { patientId: p.id, serviceId: 987_654, scheduledAt: Date.now() });
    expect(r2.status).toBe(400);
    expect(r2.json.error).toContain("خدمت");
  });

  it("waiting-list create/update/convert reject unknown patient or service", async () => {
    const p = await patient();
    expect((await call("POST", "/waiting-list", { patientId: 987_654, serviceId: defaultServiceId })).status).toBe(400);
    expect((await call("POST", "/waiting-list", { patientId: p.id, serviceId: 987_654 })).status).toBe(400);
    const e = await call("POST", "/waiting-list", { patientId: p.id, serviceId: defaultServiceId });
    expect(e.status).toBe(201);
    expect((await call("PUT", `/waiting-list/${e.json.id}`, { serviceId: 987_654 })).status).toBe(400);
    expect((await call("POST", `/waiting-list/${e.json.id}/convert`, { scheduledAt: Date.now(), serviceId: 987_654 })).status).toBe(400);
    const still = await call("GET", "/waiting-list");
    expect(still.json.data.find((x: { id: number }) => x.id === e.json.id).status).toBe("waiting");
  });
});

describe("DELETE /services/:id (bug 5)", () => {
  it("refuses deleting a service used by appointments or the waiting list, keeps price history", async () => {
    const p = await patient();
    const used = await service();
    await appointment(p.id, { serviceId: used.id });
    const r = await call("DELETE", `/services/${used.id}`);
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("غیرفعال");
    const hist = (await dbm.db.select().from(dbm.servicePriceHistoryTable).all()).filter((h) => h.serviceId === used.id);
    expect(hist.length).toBeGreaterThan(0);
    expect((await dbm.db.select().from(dbm.servicesTable).all()).some((s) => s.id === used.id)).toBe(true);

    const waitingOnly = await service();
    expect((await call("POST", "/waiting-list", { patientId: p.id, serviceId: waitingOnly.id })).status).toBe(201);
    expect((await call("DELETE", `/services/${waitingOnly.id}`)).status).toBe(400);

    const unused = await service();
    expect((await call("DELETE", `/services/${unused.id}`)).status).toBe(204);
    expect((await dbm.db.select().from(dbm.servicePriceHistoryTable).all()).some((h) => h.serviceId === unused.id)).toBe(false);
  });
});

describe("patients (bugs 6, 8, 19)", () => {
  it("duplicate file number → 409 on create and update", async () => {
    const r1 = await call("POST", "/patients", { fileNumber: "DUP-1", name: "الف", phone: "0912" });
    expect(r1.status).toBe(201);
    const r2 = await call("POST", "/patients", { fileNumber: "DUP-1", name: "ب", phone: "0913" });
    expect(r2.status).toBe(409);
    expect(r2.json.error).toContain("شماره پرونده");
    const other = await call("POST", "/patients", { fileNumber: "DUP-2", name: "ج", phone: "0914" });
    expect((await call("PUT", `/patients/${other.json.id}`, { fileNumber: "DUP-1" })).status).toBe(409);
    // ذخیرهٔ همان شماره پروندهٔ خودش مشکلی ندارد
    expect((await call("PUT", `/patients/${r1.json.id}`, { fileNumber: "DUP-1", name: "الف۲" })).status).toBe(200);
  });

  it("CSV export quotes fields and neutralizes formula injection", async () => {
    await patient('=HYPERLINK("http://x")', { fileNumber: "CSV-1", email: 'a,b "c"' });
    await patient("+98 test", { fileNumber: "CSV-2" });
    const res = await fetch(`${base}/patients/export/excel`);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM برای اکسل
    const lines = new TextDecoder().decode(bytes).split("\r\n");
    expect(lines[0].startsWith('"شناسه","شماره پرونده"')).toBe(true);
    const l1 = lines.find((l) => l.includes('"CSV-1"'))!;
    expect(l1).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(l1).toContain(`"a,b ""c"""`);
    const l2 = lines.find((l) => l.includes('"CSV-2"'))!;
    expect(l2).toContain(`"'+98 test"`);
  });

  it("upcoming-birthdays?days=0 means today only", async () => {
    const { getShamsiPartsServer } = await import("../src/lib/birthdays");
    const { tehranParts } = await import("../src/lib/tehran-time");
    const t = tehranParts(Date.now());
    const today = getShamsiPartsServer(new Date(t.y, t.m - 1, t.d, 12));
    const tomorrow = getShamsiPartsServer(new Date(t.y, t.m - 1, t.d + 1, 12));
    const pad = (n: number) => String(n).padStart(2, "0");
    const a = await patient("تولد امروز", { birthdate: `1370-${pad(today.month)}-${pad(today.day)}` });
    const b = await patient("تولد فردا", { birthdate: `1370-${pad(tomorrow.month)}-${pad(tomorrow.day)}` });
    const r0 = await call("GET", "/patients/upcoming-birthdays?days=0");
    const ids0 = r0.json.map((x: { patientId: number }) => x.patientId);
    expect(ids0).toContain(a.id);
    expect(ids0).not.toContain(b.id);
    const r1 = await call("GET", "/patients/upcoming-birthdays?days=1");
    expect(r1.json.map((x: { patientId: number }) => x.patientId)).toContain(b.id);
  });

  it("search escapes % and _ and matches Persian-digit phone queries", async () => {
    const p = await patient("جستجوی رقم", { phone: "09357778899", fileNumber: "SRCH_1" });
    await patient("دیگری", { fileNumber: "SRCHX1" });
    const pct = await call("GET", `/patients?q=${encodeURIComponent("%")}`);
    expect(pct.json.total).toBe(0);
    const us = await call("GET", `/patients?q=${encodeURIComponent("SRCH_")}`);
    expect(us.json.data.map((x: { id: number }) => x.id)).toEqual([p.id]);
    const fa = await call("GET", `/patients?q=${encodeURIComponent("۷۷۷۸۸")}`);
    expect(fa.json.data.map((x: { id: number }) => x.id)).toEqual([p.id]);
  });
});

describe("laser appointment codes (bug 7)", () => {
  it("rebooking the same client+service on the same day gets a suffixed code; Tehran date; invalid date → 400", async () => {
    const c = await call("POST", "/laser/clients", { fileNumber: "L-77", name: "لیزری", phone: "0912", gender: "female" });
    expect(c.status).toBe(201);
    const s = await call("POST", "/laser/services", { name: "فول بادی", genderCategory: "female", price: 100 });
    expect(s.status).toBe(201);
    // 2026-03-20T21:00Z = ۰۰:۳۰ تهران ۱ فروردین ۱۴۰۵ (در UTC هنوز ۲۹ اسفند است)
    const at = Date.UTC(2026, 2, 20, 21, 0);
    const a1 = await call("POST", "/laser/appointments", { clientId: c.json.id, serviceId: s.json.id, scheduledAt: at });
    expect(a1.status).toBe(201);
    expect(a1.json.appointmentCode).toBe(`14050101-L-77-${s.json.code}`);
    const a2 = await call("POST", "/laser/appointments", { clientId: c.json.id, serviceId: s.json.id, scheduledAt: at + 3600_000 });
    expect(a2.status).toBe(201);
    expect(a2.json.appointmentCode).toBe(`14050101-L-77-${s.json.code}-2`);
    const a3 = await call("POST", "/laser/appointments", { clientId: c.json.id, serviceId: s.json.id, scheduledAt: at + 7200_000 });
    expect(a3.json.appointmentCode).toBe(`14050101-L-77-${s.json.code}-3`);

    const bad = await call("POST", "/laser/appointments", { clientId: c.json.id, serviceId: s.json.id, scheduledAt: "not-a-date" });
    expect(bad.status).toBe(400);
    expect((await call("PUT", `/laser/appointments/${a1.json.id}`, { scheduledAt: "nope" })).status).toBe(400);
  });
});

describe("session numbers after reinstating a cancelled appointment (bug 10)", () => {
  it("renumbers the reinstated appointment so numbers don't collide", async () => {
    const p = await patient();
    const a = await appointment(p.id);
    expect(a.sessionNumber).toBe(1);
    expect((await call("PUT", `/appointments/${a.id}`, { status: "cancelled" })).status).toBe(200);
    const b = await appointment(p.id);
    expect(b.sessionNumber).toBe(1);
    const back = await call("PUT", `/appointments/${a.id}`, { status: "scheduled" });
    expect(back.status).toBe(200);
    expect(back.json.sessionNumber).toBe(2);

    // همین قاعده در تغییر وضعیت گروهی
    expect((await call("PUT", `/appointments/${b.id}`, { status: "cancelled" })).status).toBe(200);
    const c = await appointment(p.id);
    expect(c.sessionNumber).toBe(3);
    const bulk = await call("POST", "/appointments/bulk-status", { ids: [b.id], status: "confirmed" });
    expect(bulk.status).toBe(200);
    expect((await apptRow(b.id))?.sessionNumber).toBe(4);
  });
});

describe("withPayments deletes check the DB role (bug 11)", () => {
  it("a stale admin token for a staff user cannot delete with payments", async () => {
    const p = await patient();
    const a = await appointment(p.id, { deposit: 50_000 });
    const staff = await user("staff", ["appointments"]);
    await as({ sub: staff.id, role: "admin", username: staff.username, permissions: [] }, async () => {
      expect((await call("DELETE", `/appointments/${a.id}?withPayments=1`)).status).toBe(403);
      expect((await call("DELETE", "/appointments/bulk", { ids: [a.id], withPayments: true })).status).toBe(403);
    });
    expect(await apptRow(a.id)).toBeDefined();
    expect((await call("DELETE", `/appointments/${a.id}?withPayments=1`)).status).toBe(204);
  });
});

describe("PUT /sms/settings validates before writing (bug 12)", () => {
  it("does not save any field when a pattern code is invalid", async () => {
    expect((await call("PUT", "/sms/settings", { username: "before" })).status).toBe(200);
    const r = await call("PUT", "/sms/settings", { username: "after", enabledPayment: true, bodyIdPayment: "abc" });
    expect(r.status).toBe(400);
    const s = await call("GET", "/sms/settings");
    expect(s.json.username).toBe("before");
    const ok = await call("PUT", "/sms/settings", { username: "after", bodyIdPayment: " 123 " });
    expect(ok.status).toBe(200);
    expect(ok.json.username).toBe("after");
    expect(ok.json.bodyIdPayment).toBe("123");
  });
});

describe("waiting list conversion is one-way (bug 13)", () => {
  it("refuses moving a converted entry back to waiting and converting twice", async () => {
    const p = await patient();
    const e = await call("POST", "/waiting-list", { patientId: p.id, serviceId: defaultServiceId });
    const conv = await call("POST", `/waiting-list/${e.json.id}/convert`, { scheduledAt: Date.now() });
    expect(conv.status).toBe(201);
    const back = await call("PUT", `/waiting-list/${e.json.id}`, { status: "waiting" });
    expect(back.status).toBe(400);
    // حتی اگر وضعیت مستقیماً برگشته باشد، تبدیل دوباره رد می‌شود
    await dbm.db.update(dbm.waitingListTable).set({ status: "waiting" });
    const again = await call("POST", `/waiting-list/${e.json.id}/convert`, { scheduledAt: Date.now() });
    expect(again.status).toBe(409);
    const appts = (await dbm.db.select().from(dbm.appointmentsTable).all()).filter((a) => a.patientId === p.id);
    expect(appts).toHaveLength(1);
  });
});

describe("deleting an appointment cleans up manual commissions (bug 14)", () => {
  it("deletes unpaid manual commissions and refuses when one is already paid", async () => {
    const p = await patient();
    const a = await appointment(p.id);
    await dbm.db.insert(dbm.commissionsTable).values({ recipientType: "staff", recipientId: 1, appointmentId: a.id, amount: 1000 });
    expect((await call("DELETE", `/appointments/${a.id}`)).status).toBe(204);
    expect((await dbm.db.select().from(dbm.commissionsTable).all()).some((c) => c.appointmentId === a.id)).toBe(false);

    const b = await appointment(p.id);
    await dbm.db.insert(dbm.commissionsTable).values({ recipientType: "staff", recipientId: 1, appointmentId: b.id, amount: 1000, isPaid: true });
    const r = await call("DELETE", `/appointments/${b.id}`);
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("تسویه");
    expect(await apptRow(b.id)).toBeDefined();
    const bulk = await call("DELETE", "/appointments/bulk", { ids: [b.id] });
    expect(bulk.status).toBe(400);
    expect(await apptRow(b.id)).toBeDefined();
  });
});

describe("/activity hides usernames (bug 15)", () => {
  it("returns feed rows without the username column", async () => {
    const r = await call("GET", "/activity?limit=5");
    expect(r.status).toBe(200);
    expect(r.json.length).toBeGreaterThan(0);
    for (const row of r.json) {
      expect(row).not.toHaveProperty("username");
      expect(row).toHaveProperty("description");
    }
  });
});

describe("PUT /users/:id duplicate username (bug 16)", () => {
  it("returns 409 instead of 500", async () => {
    const a = await call("POST", "/users", { username: "dupuser_a", password: "secret1" });
    const b = await call("POST", "/users", { username: "dupuser_b", password: "secret1" });
    expect(a.status).toBe(201);
    const r = await call("PUT", `/users/${b.json.id}`, { username: "DUPUSER_A" });
    expect(r.status).toBe(409);
    expect(r.json.message).toContain("نام کاربری");
    expect((await call("PUT", `/users/${a.json.id}`, { username: "dupuser_a" })).status).toBe(200);
  });
});

describe("reminder dueAt sanity (bug 17)", () => {
  it("rejects milliseconds and years outside 2000-2100 on create and update", async () => {
    const ok = await call("POST", "/reminders", { title: "ok", dueAt: Math.floor(Date.now() / 1000) + 3600 });
    expect(ok.status).toBe(201);
    const ms = await call("POST", "/reminders", { title: "ms", dueAt: Date.now() });
    expect(ms.status).toBe(400);
    expect(ms.json.error).toContain("تاریخ");
    expect((await call("POST", "/reminders", { title: "old", dueAt: Date.UTC(1990, 0, 1) / 1000 })).status).toBe(400);
    expect((await call("POST", "/reminders", { title: "far", dueAt: Date.UTC(2150, 0, 1) / 1000 })).status).toBe(400);
    expect((await call("PUT", `/reminders/${ok.json.id}`, { dueAt: Date.now() })).status).toBe(400);
    expect((await call("PUT", `/reminders/${ok.json.id}`, { dueAt: Date.UTC(1405 - 621, 0, 1) / 1000 })).status).toBe(400);
    expect((await call("PUT", `/reminders/${ok.json.id}`, { dueAt: Math.floor(Date.now() / 1000) })).status).toBe(200);
  });
});
