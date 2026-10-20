import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

// تاریخچهٔ تغییرات: ثبت کاربرِ انجام‌دهنده (AsyncLocalStorage در routes/index.ts)،
// فیلترهای GET /activity/log، دسترسی فقط مدیر و GET /backup/last — روی SQLite موقت.

vi.mock("../src/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../lib/db/migrations");

let dbm: typeof import("@workspace/db");
let auth: typeof import("../src/lib/auth");
let server: http.Server;
let base: string;
const tokens: Record<string, string> = {};

async function createUser(username: string, role: "admin" | "staff", permissions: string[]) {
  const [u] = await dbm.db
    .insert(dbm.usersTable)
    .values({ username, password: "x", role, permissions: JSON.stringify(permissions) })
    .returning();
  tokens[username] = auth.signToken({ sub: u.id, username, role, permissions });
}

async function call(user: string, method: string, p: string, body?: unknown) {
  const headers: Record<string, string> = { authorization: `Bearer ${tokens[user]}` };
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

type LogPage = {
  items: Array<{ action: string; entityType: string; description: string; username: string | null; createdAt: number }>;
  total: number;
  hasMore: boolean;
  entityTypes: string[];
  actions: string[];
};
async function log(qs = ""): Promise<LogPage> {
  const r = await call("boss", "GET", `/activity/log${qs ? `?${qs}` : ""}`);
  expect(r.status).toBe(200);
  return r.json;
}

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "activity-log-test-"));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, "test-clinic.db");
  dbm = await import("@workspace/db");
  await dbm.runMigrations(MIGRATIONS_DIR);
  auth = await import("../src/lib/auth");
  const { default: router } = await import("../src/routes");

  await createUser("boss", "admin", []);
  await createUser("sara", "staff", ["patients", "dashboard", "backup"]);

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("activity log records the acting user", () => {
  it("stores the username of whoever made the change", async () => {
    const a = await call("boss", "POST", "/patients", { fileNumber: "AL-1", name: "مریم مدیری", phone: "09120000011" });
    expect(a.status).toBe(201);
    const b = await call("sara", "POST", "/patients", { fileNumber: "AL-2", name: "نگار کارمندی", phone: "09120000012" });
    expect(b.status).toBe(201);
    const u = await call("sara", "PUT", `/patients/${a.json.id}`, { fileNumber: "AL-1", name: "مریم ویرایش‌شده", phone: "09120000011" });
    expect([200, 201]).toContain(u.status);

    const page = await log("entityType=patient");
    const byDesc = (s: string) => page.items.find((i) => i.description.includes(s));
    expect(byDesc("مریم مدیری")).toMatchObject({ action: "create", username: "boss" });
    expect(byDesc("نگار کارمندی")).toMatchObject({ action: "create", username: "sara" });
    const upd = page.items.find((i) => i.action === "update");
    expect(upd?.username).toBe("sara");
  });

  it("concurrent requests keep their own user", async () => {
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        call(i % 2 ? "sara" : "boss", "POST", "/patients", { fileNumber: `AL-C${i}`, name: `هم‌زمان-${i}`, phone: `0912000010${i}` }),
      ),
    );
    const page = await log("q=" + encodeURIComponent("هم‌زمان"));
    expect(page.total).toBe(6);
    for (const row of page.items) {
      const i = Number(row.description.match(/هم‌زمان-(\d)/)![1]);
      expect(row.username).toBe(i % 2 ? "sara" : "boss");
    }
  });
});

describe("GET /activity/log filters", () => {
  beforeAll(async () => {
    const t = dbm.activityLogTable;
    await dbm.db.insert(t).values([
      { action: "create", entityType: "payment", entityId: 1, description: "پرداخت قدیمی ۱۰۰٪", username: "boss", createdAt: 1_000_000 },
      { action: "delete", entityType: "payment", entityId: 2, description: "حذف پرداخت", username: "sara", createdAt: 1_000_100 },
      { action: "update", entityType: "service", entityId: 3, description: "ویرایش قیمت خدمت", username: null, createdAt: 1_000_200 },
    ]);
  });

  it("filters by date range (seconds)", async () => {
    const page = await log("from=1000050&to=1000250");
    expect(page.items.map((i) => i.description)).toEqual(["ویرایش قیمت خدمت", "حذف پرداخت"]);
    expect(page.total).toBe(2);
  });

  it("filters by entity type and action", async () => {
    expect((await log("entityType=payment")).total).toBe(2);
    const del = await log("entityType=payment&action=delete");
    expect(del.items).toHaveLength(1);
    expect(del.items[0]).toMatchObject({ description: "حذف پرداخت", username: "sara" });
  });

  it("text search matches description or user and treats % literally", async () => {
    expect((await log("q=" + encodeURIComponent("قیمت"))).items.map((i) => i.description)).toEqual(["ویرایش قیمت خدمت"]);
    expect((await log("q=" + encodeURIComponent("۱۰۰٪"))).total).toBe(1);
    expect((await log("q=%25")).total).toBe(0);
    const bySara = await log("q=sara&to=1000300");
    expect(bySara.items.map((i) => i.description)).toEqual(["حذف پرداخت"]);
  });

  it("pages with limit/offset, newest first", async () => {
    const all = await log("to=1000300");
    expect(all.total).toBe(3);
    const p1 = await log("to=1000300&limit=2");
    expect(p1.items).toHaveLength(2);
    expect(p1.hasMore).toBe(true);
    const p2 = await log("to=1000300&limit=2&offset=2");
    expect(p2.items).toHaveLength(1);
    expect(p2.hasMore).toBe(false);
    expect([...p1.items, ...p2.items].map((i) => i.createdAt)).toEqual([1_000_200, 1_000_100, 1_000_000]);
  });

  it("returns the distinct entity types and actions for the filter menus", async () => {
    const page = await log("limit=1");
    expect(page.entityTypes).toEqual(expect.arrayContaining(["patient", "payment", "service"]));
    expect(page.actions).toEqual(expect.arrayContaining(["create", "update", "delete"]));
  });

  it("is admin-only; the dashboard feed stays open to dashboard users", async () => {
    expect((await call("sara", "GET", "/activity/log")).status).toBe(403);
    expect((await call("sara", "GET", "/activity?limit=5")).status).toBe(200);
  });
});

describe("GET /backup/last", () => {
  it("reports no backup, then a fresh one, then a stale one", async () => {
    await dbm.db.delete(dbm.appSettingsTable);
    expect((await call("sara", "GET", "/backup/last")).json).toEqual({ lastBackupAt: null, ok: false });

    const { setSetting, LAST_AUTO_BACKUP_KEY } = await import("../src/lib/backup-service");
    const now = Date.now();
    await setSetting(LAST_AUTO_BACKUP_KEY, String(now - 3_600_000));
    expect((await call("boss", "GET", "/backup/last")).json).toEqual({ lastBackupAt: Math.floor((now - 3_600_000) / 1000), ok: true });

    await setSetting(LAST_AUTO_BACKUP_KEY, String(now - 3 * 86_400_000));
    expect((await call("sara", "GET", "/backup/last")).json).toMatchObject({ ok: false });
  });
});
