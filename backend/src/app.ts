import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerSyncRoutes } from "./routes/sync.js";
import { registerTaskVideoRoutes } from "./routes/taskVideos.js";
import { AutoSyncService } from "./services/autoSync.js";
import { AppDatabase } from "./services/db.js";
import { ScraperService } from "./services/scraper.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..", "..");
const frontendDistDir = path.join(projectRoot, "frontend", "dist");

export function buildApp() {
  const app = Fastify({ logger: true });
  const db = new AppDatabase();
  const scraper = new ScraperService(db, app.log);
  const autoSync = new AutoSyncService(db, scraper, app.log);

  void app.register(cors, { origin: true });
  registerAccountRoutes(app, db, scraper);
  registerSyncRoutes(app, autoSync);
  registerTaskVideoRoutes(app, db);

  if (fs.existsSync(frontendDistDir)) {
    void app.register(fastifyStatic, { root: frontendDistDir });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ message: "Route not found" });
      }

      return reply.sendFile("index.html");
    });
  }

  app.addHook("onReady", async () => {
    autoSync.start();
  });

  app.addHook("onClose", async () => {
    autoSync.stop();
  });

  return app;
}
