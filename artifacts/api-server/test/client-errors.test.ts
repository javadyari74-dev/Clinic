import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// The route logs through ../src/lib/logger. Mock it so we can assert which
// reports were recorded vs. coalesced without spinning up pino's pretty
// transport worker. An accepted report emits a logger.error with the message
// "Frontend error boundary report"; the persistence catch path emits a
// separate logger.error("Failed to persist..."), so we always count by message
// to isolate throttle behavior from the (mocked) DB outcome.
const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../src/lib/logger", () => ({ logger: loggerMock }));

// The route persists accepted reports to the DB. Stub it so inserts succeed and
// the test never depends on a real database connection.
vi.mock("@workspace/db", () => ({
  db: {
    insert: () => ({ values: () => Promise.resolve() }),
    select: () => ({
      from: () => ({
        orderBy: () => ({ limit: () => Promise.resolve([]) }),
      }),
    }),
  },
  clientErrorsTable: {},
}));

const RECORDED_MESSAGE = "Frontend error boundary report";

// Count only the log lines that mean "a distinct report was accepted/recorded",
// ignoring any persistence-failure logs so assertions track throttle behavior.
function recordedCount(): number {
  return loggerMock.error.mock.calls.filter(
    (call) => call[1] === RECORDED_MESSAGE,
  ).length;
}

// Mirror the constants in src/routes/client-errors.ts.
const DEDUPE_WINDOW_MS = 30_000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 20;

let server: http.Server | undefined;
let baseUrl = "";
let now = 0;

async function startServer() {
  // Re-import with a fresh module graph so the in-memory throttle maps reset
  // between tests.
  vi.resetModules();
  const { default: clientErrorsRouter } = await import(
    "../src/routes/client-errors"
  );
  const app = express();
  // So req.ip honours X-Forwarded-For and we can simulate distinct clients.
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(clientErrorsRouter);

  server = await new Promise<http.Server>((resolve) => {
    const s = http.createServer(app);
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopServer() {
  if (!server) return;
  const s = server;
  server = undefined;
  await new Promise<void>((resolve, reject) =>
    s.close((err) => (err ? reject(err) : resolve())),
  );
}

interface ReportInput {
  message: string;
  url?: string;
  ip?: string;
}

async function postReport({ message, url, ip }: ReportInput) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (ip) headers["x-forwarded-for"] = ip;
  const res = await fetch(`${baseUrl}/client-errors`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message, url }),
  });
  // Drain the (empty) body so the socket can be reused/closed cleanly.
  await res.arrayBuffer();
  return res;
}

beforeEach(async () => {
  now = 1_000_000;
  // The route reads Date.now() for both throttle windows; drive it manually so
  // we can deterministically advance time without real waits.
  vi.spyOn(Date, "now").mockImplementation(() => now);
  loggerMock.error.mockClear();
  loggerMock.warn.mockClear();
  await startServer();
});

afterEach(async () => {
  await stopServer();
  vi.restoreAllMocks();
});

describe("POST /client-errors de-duplication", () => {
  it("records an identical message+url only once within the window, but records distinct reports", async () => {
    await postReport({ message: "Boom", url: "/patients" }); // recorded
    await postReport({ message: "Boom", url: "/patients" }); // duplicate, dropped
    now += 5_000;
    await postReport({ message: "Boom", url: "/patients" }); // still within window, dropped

    expect(recordedCount()).toBe(1);

    // A different message is a distinct crash -> recorded.
    await postReport({ message: "Different crash", url: "/patients" });
    // The same message on a different page is also distinct -> recorded.
    await postReport({ message: "Boom", url: "/staff" });

    expect(recordedCount()).toBe(3);

    // Every response is a 204 ack so the client never retries, whether the
    // report was recorded or dropped.
    const res = await postReport({ message: "Boom", url: "/patients" });
    expect(res.status).toBe(204);
  });

  it("emits a single coalesced summary of suppressed duplicates once the window rolls over", async () => {
    await postReport({ message: "Boom", url: "/patients" }); // recorded
    await postReport({ message: "Boom", url: "/patients" }); // suppressed (1)
    await postReport({ message: "Boom", url: "/patients" }); // suppressed (2)

    expect(loggerMock.warn).not.toHaveBeenCalled();

    // Past the dedupe window, an unrelated report triggers a prune that flushes
    // the suppressed count as one summary line.
    now += DEDUPE_WINDOW_MS + 1;
    await postReport({ message: "Unrelated", url: "/inventory" });

    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    expect(loggerMock.warn.mock.calls[0][0]).toMatchObject({ suppressed: 2 });
  });
});

describe("POST /client-errors per-IP rate limit", () => {
  it("drops distinct reports past the per-IP cap and resets after the window", async () => {
    const ip = "203.0.113.7";

    for (let i = 0; i < RATE_MAX_PER_WINDOW; i++) {
      await postReport({ message: `crash-${i}`, url: "/p", ip });
    }
    expect(recordedCount()).toBe(RATE_MAX_PER_WINDOW);

    // One past the cap (still a distinct message) is dropped.
    await postReport({ message: "crash-over", url: "/p", ip });
    expect(recordedCount()).toBe(RATE_MAX_PER_WINDOW);

    // After the rate window elapses the budget resets and reports flow again.
    now += RATE_WINDOW_MS + 1;
    await postReport({ message: "crash-after-reset", url: "/p", ip });
    expect(recordedCount()).toBe(RATE_MAX_PER_WINDOW + 1);
  });

  it("tracks the rate budget independently per client IP", async () => {
    const ipA = "198.51.100.1";
    const ipB = "198.51.100.2";

    for (let i = 0; i < RATE_MAX_PER_WINDOW; i++) {
      await postReport({ message: `a-${i}`, url: "/p", ip: ipA });
    }
    // ipA is at its cap; its next distinct report is dropped...
    await postReport({ message: "a-over", url: "/p", ip: ipA });
    expect(recordedCount()).toBe(RATE_MAX_PER_WINDOW);

    // ...but a different client is unaffected.
    await postReport({ message: "b-0", url: "/p", ip: ipB });
    expect(recordedCount()).toBe(RATE_MAX_PER_WINDOW + 1);
  });

  it("does not let identical duplicates consume the per-IP budget", async () => {
    const ip = "192.0.2.55";

    // Spam one identical crash far more than the cap; only the first is recorded
    // and the duplicates must not exhaust the rate budget.
    for (let i = 0; i < RATE_MAX_PER_WINDOW + 10; i++) {
      await postReport({ message: "same", url: "/p", ip });
    }
    expect(recordedCount()).toBe(1);

    // A later, genuinely distinct crash from the same client still gets logged
    // because the duplicates never counted against the budget.
    await postReport({ message: "genuinely-different", url: "/p", ip });
    expect(recordedCount()).toBe(2);
  });
});
