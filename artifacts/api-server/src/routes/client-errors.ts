import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function asString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
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

  logger.error({ clientError: report }, "Frontend error boundary report");

  res.status(204).end();
});

export default router;
