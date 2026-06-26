import path from "path";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// When running as a packaged desktop app, the Express server also serves the
// built frontend (single-origin) instead of the Replit path-based proxy.
// This is gated behind SERVE_STATIC_DIR so the Replit dev/deploy setup is
// left completely unchanged when the variable is absent.
const staticDir = process.env["SERVE_STATIC_DIR"];

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));

app.use("/api", router);

if (staticDir) {
  app.use(express.static(staticDir));

  // SPA fallback: any non-API GET request returns index.html so client-side
  // routing (wouter) works on hard refresh / deep links.
  app.use((req, res, next) => {
    if (req.method !== "GET") {
      next();
      return;
    }
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

export default app;
