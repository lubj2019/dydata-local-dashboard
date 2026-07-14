import type { FastifyInstance } from "fastify";
import { AutoSyncService } from "../services/autoSync.js";

export function registerSyncRoutes(app: FastifyInstance, autoSync: AutoSyncService) {
  app.get("/api/sync-status", async () => {
    return autoSync.getStatus();
  });

  app.post("/api/sync/run-all", async () => {
    return autoSync.requestManualFullSync();
  });
}
