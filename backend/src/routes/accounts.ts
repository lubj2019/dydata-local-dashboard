import type { FastifyInstance } from "fastify";
import { AppDatabase } from "../services/db.js";
import { ScraperService } from "../services/scraper.js";

function readDisplayName(body: unknown): string {
  if (!body || typeof body !== "object" || typeof (body as { displayName?: unknown }).displayName !== "string") {
    throw new Error("displayName 必填");
  }

  const displayName = (body as { displayName: string }).displayName.trim();
  if (!displayName) {
    throw new Error("displayName 必填");
  }

  return displayName;
}

export function registerAccountRoutes(app: FastifyInstance, db: AppDatabase, scraper: ScraperService) {
  app.get("/api/accounts", async () => {
    return db.listAccounts().map((account) => ({
      id: account.id,
      displayName: account.displayName,
      platform: account.platform,
      loginStatus: account.loginStatus,
      lastSyncAt: account.lastSyncAt,
      lastError: account.lastError
    }));
  });

  app.post("/api/accounts", async (request, reply) => {
    try {
      const displayName = readDisplayName(request.body);
      return db.createAccount(displayName);
    } catch (error) {
      return reply.status(400).send({ message: error instanceof Error ? error.message : "参数错误" });
    }
  });

  app.post("/api/accounts/:accountId/login", async (request, reply) => {
    try {
      const accountId = (request.params as { accountId: string }).accountId;
      await scraper.launchLogin(accountId);
      return { status: "login_started" };
    } catch (error) {
      return reply.status(400).send({ message: error instanceof Error ? error.message : "登录启动失败" });
    }
  });

  app.post("/api/accounts/:accountId/sync", async (request, reply) => {
    try {
      const accountId = (request.params as { accountId: string }).accountId;
      await scraper.syncAccount(accountId);
      return { status: "synced" };
    } catch (error) {
      return reply.status(400).send({ message: error instanceof Error ? error.message : "同步失败" });
    }
  });

  app.delete("/api/accounts/:accountId", async (request, reply) => {
    try {
      const accountId = (request.params as { accountId: string }).accountId;
      db.deleteAccount(accountId);
      return { status: "deleted" };
    } catch (error) {
      return reply.status(400).send({ message: error instanceof Error ? error.message : "删除账号失败" });
    }
  });
}
