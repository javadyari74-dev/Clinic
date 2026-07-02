import path from "path";
import { fileURLToPath } from "url";
import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "@workspace/db";
import { seedAdminUser } from "./lib/seed";
import { backfillAppointmentCodes, backfillPaymentSnapshots, backfillUuids } from "./lib/backfill";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const migrationsFolder = path.resolve(__dirname, "migrations");

runMigrations(migrationsFolder)
  .then(async () => {
    logger.info("Database migrations applied successfully");
    await seedAdminUser();
    await backfillAppointmentCodes();
    await backfillPaymentSnapshots();
    const uuidReport = await backfillUuids();
    const uuidFilled = Object.values(uuidReport).reduce((a, b) => a + b, 0);
    if (uuidFilled > 0) {
      logger.info({ uuidReport, uuidFilled }, "Backfilled UUIDs for existing records");
    } else {
      logger.info("UUID backfill: all records already have a uuid");
    }
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, "Failed to apply database migrations");
    process.exit(1);
  });
