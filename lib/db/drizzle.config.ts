import { defineConfig } from "drizzle-kit";
import path from "path";

const DB_PATH = process.env.SQLITE_DB_PATH ?? path.join(__dirname, "../../clinic.db");

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  out: path.join(__dirname, "./migrations"),
  dialect: "turso",
  dbCredentials: {
    url: `file:${DB_PATH}`,
  },
});
