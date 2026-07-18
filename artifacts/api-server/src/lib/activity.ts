import { db } from "@workspace/db";
import { activityLogTable } from "@workspace/db";
import { logger } from "./logger";

export async function logActivity(
  action: string,
  entityType: string,
  entityId: number | null,
  description: string
): Promise<void> {
  try {
    await db.insert(activityLogTable).values({ action, entityType, entityId, description });
  } catch (err) {
    logger.error({ err }, "Failed to log activity");
  }
}
