import cors from "@fastify/cors";
import Fastify from "fastify";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerSyncRoutes } from "./routes/sync.js";
import { registerTaskVideoRoutes } from "./routes/taskVideos.js";
import { AutoSyncService } from "./services/autoSync.js";
import { AppDatabase } from "./services/db.js";
import { ScraperService } from "./services/scraper.js";

export function buildApp() {
  const app = Fastify({ logger: true });
  const db = new AppDatabase();
  const scraper = new ScraperService(db, app.log);
  const autoSync = new AutoSyncService(db, scraper, app.log);

  void app.register(cors, { origin: true });
  registerAccountRoutes(app, db, scraper);
  registerSyncRoutes(app, autoSync);
  registerTaskVideoRoutes(app, db);

  app.addHook("onReady", async () => {
    autoSync.start();
  });

  app.addHook("onClose", async () => {
    autoSync.stop();
  });

  return app;
}
