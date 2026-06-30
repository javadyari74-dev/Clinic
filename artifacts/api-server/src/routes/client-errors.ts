import { Router, type IRouter } from "express";
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
// can fire many near-identical reports per second. We never persist these
// reports, but unbounded logging is still noise/IO we want to avoid. Two
// guards, both purely in-memory (acceptable since this endpoint only logs):
//
//  1. De-duplication: the same error+page is logged at most once per
//     DEDUPE_WINDOW_MS. Repeats inside the window are counted and folded
//     into a single summary line when the window rolls over, so we keep the
//     signal that it's still crashing without one-line-per-crash spam.
//  2. Per-IP rate limit: a hard cap on how many *distinct* reports a single
//     client can log per RATE_WINDOW_MS, so a client cycling through many
//     unique messages still can't flood the logs.
//
// Distinct crashes (different message or page) within the window are still
// recorded, so legitimate separate failures are never lost.

const DEDUPE_WINDOW_MS = 30_000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 20;
const MAX_TRACKED_SIGNATURES = 1000;

interface SeenEntry {
  firstAt: number;
  lastAt: number;
  suppressed: number;
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
// reportable when the session token is missing/expired. It only logs the
// report server-side; it never touches the database.
router.post("/client-errors", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const report = {
    message: asString(body.message, 2000) ?? "Unknown client error",
    stack: asString(body.stack, 8000),
    componentStack: asString(body.componentStack, 8000),
    url: asString(body.url, 2000),
    userAgent: asString(body.userAgent, 1000),
    at: asString(body.at, 100),
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
    res.status(204).end();
    return;
  }

  const client = req.ip ?? "unknown";
  if (isRateLimited(client, now)) {
    // Acknowledge so the client doesn't retry, but drop the report.
    res.status(204).end();
    return;
  }

  seen.set(signature, { firstAt: now, lastAt: now, suppressed: 0 });
  logger.error({ clientError: report }, "Frontend error boundary report");

  res.status(204).end();
});

export default router;
