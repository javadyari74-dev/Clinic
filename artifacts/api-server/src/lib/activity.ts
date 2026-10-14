import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "@workspace/db";
import { activityLogTable } from "@workspace/db";
import { logger } from "./logger";

// کاربرِ درخواست جاری؛ یک بار پس از احراز هویت (routes/index.ts) تنظیم می‌شود تا
// logActivity بدون تغییر امضا در همهٔ مسیرها، انجام‌دهندهٔ تغییر را ثبت کند.
const actorStorage = new AsyncLocalStorage<{ username: string | null }>();

/** اجرای ادامهٔ درخواست در زمینهٔ کاربر مشخص */
export function runWithActor<T>(username: string | null | undefined, fn: () => T): T {
  return actorStorage.run({ username: username ?? null }, fn);
}

export function currentActor(): string | null {
  return actorStorage.getStore()?.username ?? null;
}

export async function logActivity(
  action: string,
  entityType: string,
  entityId: number | null,
  description: string
): Promise<void> {
  try {
    await db.insert(activityLogTable).values({ action, entityType, entityId, description, username: currentActor() });
  } catch (err) {
    logger.error({ err }, "Failed to log activity");
  }
}
