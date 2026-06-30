import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, clientErrorsTable } from "@workspace/db";
import { requireAdmin } from "../lib/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function asString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

// --- In-memory throttling -------------------------------------------------
// A page stuck in a render loop (or an operator hammering "بارگذاری مجدد")
// can fire many near-identical reports per second. Each accepted report is
// both logged and persisted, so unbounded repeats are noise/IO (and DB rows)
// we want to avoid. Two guards, both purely in-memory:
//
//  1. De-duplication: the same error+page is logged/stored at most once per
//     DEDUPE_WINDOW_MS. Repeats inside the window are counted and folded
//     into a single summary line when the window rolls over, so we keep the
//     signal that it's still crashing without one-row-per-crash spam.
//  2. Per-IP rate limit: a hard cap on how many *distinct* reports a single
//     client can record per RATE_WINDOW_MS, so a client cycling through many
//     unique messages still can't flood the logs or the table.
//
// Distinct crashes (different message or page) within the window are still
// recorded, so legitimate separate failures are never lost.

const DEDUPE_WINDOW_MS = 30_000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 20;
const MAX_TRACKED_SIGNATURES = 1000;
// Once the same error+page has been suppressed this many times inside the
// dedupe window, it's no longer a one-off crash — the page is stuck (render
// loop, or an operator reloading into the same failure). At that point we stop
// silently dropping the repeat and instead tell the reporting client to raise
// an operator-visible warning. A handful of accidental double-reloads stays
// below this, so distinct one-off crashes never trip it.
const PERSISTENT_CRASH_THRESHOLD = 3;

interface SeenEntry {
  firstAt: number;
  lastAt: number;
  suppressed: number;
  // Set once we've logged the persistent-crash warning for this signature so
  // the server log gets a single escalation line, not one per suppressed hit.
  alerted: boolean;
}

const seen = new Map<string, SeenEntry>();

interface RateEntry {
  windowStart: number;
  count: number;
}

const rateByClient = new Map<string, RateEntry>();

function pruneSeen(now: number) {
  for (const [key, entry] of seen) {
    if (now - entry.lastAt > DEDUPE_WINDOW_MS) {
      if (entry.suppressed > 0) {
        logger.warn(
          { signature: key, suppressed: entry.suppressed },
          "Coalesced duplicate frontend error reports",
        );
      }
      seen.delete(key);
    }
  }
  // Hard cap so a pathological client can't grow the map without bound.
  if (seen.size > MAX_TRACKED_SIGNATURES) {
    const oldest = [...seen.entries()].sort(
      (a, b) => a[1].lastAt - b[1].lastAt,
    );
    for (const [key] of oldest.slice(0, seen.size - MAX_TRACKED_SIGNATURES)) {
      seen.delete(key);
    }
  }
}

function pruneRate(now: number) {
  for (const [key, entry] of rateByClient) {
    if (now - entry.windowStart > RATE_WINDOW_MS) {
      rateByClient.delete(key);
    }
  }
  if (rateByClient.size > MAX_TRACKED_SIGNATURES) {
    const oldest = [...rateByClient.entries()].sort(
      (a, b) => a[1].windowStart - b[1].windowStart,
    );
    for (const [key] of oldest.slice(
      0,
      rateByClient.size - MAX_TRACKED_SIGNATURES,
    )) {
      rateByClient.delete(key);
    }
  }
}

// Only distinct (non-duplicate) reports count against the per-client budget,
// so a page spamming one identical crash can't exhaust the budget and starve
// out a later, genuinely different crash from the same client.
function isRateLimited(client: string, now: number): boolean {
  const entry = rateByClient.get(client);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateByClient.set(client, { windowStart: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX_PER_WINDOW;
}

// Lightweight, unauthenticated endpoint for the frontend error boundary to
// report render crashes. Mounted before requireAuth so a crash is still
// reportable when the session token is missing/expired. The report is both
// logged server-side and persisted so an admin can review it in-app later.
router.post("/client-errors", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const report = {
    message: asString(body.message, 2000) ?? "Unknown client error",
    stack: asString(body.stack, 8000) ?? null,
    componentStack: asString(body.componentStack, 8000) ?? null,
    url: asString(body.url, 2000) ?? null,
    userAgent: asString(body.userAgent, 1000) ?? null,
    occurredAt: asString(body.at, 100) ?? null,
  };

  const now = Date.now();
  pruneSeen(now);
  pruneRate(now);

  // De-duplicate first so identical repeats are dropped without consuming the
  // per-client rate budget, leaving room for genuinely distinct crashes.
  const signature = `${report.message}\n${report.url ?? ""}`;
  const existing = seen.get(signature);
  if (existing && now - existing.lastAt <= DEDUPE_WINDOW_MS) {
    existing.lastAt = now;
    existing.suppressed += 1;

    // A page that keeps crashing into the same error is exactly the case an
    // on-site operator should be warned about, not have buried in logs. Once
    // the suppression count crosses the threshold, tell the reporting client
    // to raise a visible warning (and leave a single escalation line in the
    // server log). Total occurrences = initial logged report + suppressed.
    if (existing.suppressed >= PERSISTENT_CRASH_THRESHOLD) {
      const occurrences = existing.suppressed + 1;
      if (!existing.alerted) {
        existing.alerted = true;
        logger.warn(
          { signature, occurrences },
          "Persistently crashing frontend page detected",
        );
      }
      res.status(200).json({ persistentCrash: true, occurrences });
      return;
    }

    res.status(204).end();
    return;
  }

  const client = req.ip ?? "unknown";
  if (isRateLimited(client, now)) {
    // Acknowledge so the client doesn't retry, but drop the report.
    res.status(204).end();
    return;
  }

  seen.set(signature, {
    firstAt: now,
    lastAt: now,
    suppressed: 0,
    alerted: false,
  });
  logger.error({ clientError: report }, "Frontend error boundary report");

  try {
    await db.insert(clientErrorsTable).values(report);
  } catch (err) {
    // Never let a persistence failure break crash reporting; the log above
    // is still the source of truth in that case.
    logger.error({ err }, "Failed to persist client error report");
  }

  res.status(204).end();
});

// Admin-only listing of recent crash reports, newest first. Gated with
// requireAdmin because this router is mounted before the global requireAuth.
router.get("/client-errors", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(clientErrorsTable)
    .orderBy(desc(clientErrorsTable.createdAt))
    .limit(200);
  res.json(rows);
});

export default router;
