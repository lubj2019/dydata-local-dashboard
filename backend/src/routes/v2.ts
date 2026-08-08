import type { FastifyInstance } from "fastify";
import { AutoSyncService } from "../services/autoSync.js";
import { AppDatabase } from "../services/db.js";
import { ScraperService } from "../services/scraper.js";
import { StatisticsService } from "../services/statistics.js";

function readText(body: unknown, field: "displayName" | "videoId"): string {
  const value = body && typeof body === "object" ? (body as Record<string, unknown>)[field] : null;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} 必填`);
  }
  return value.trim();
}

function accountPayload(account: ReturnType<AppDatabase["getAccount"]>, isSyncing = false) {
  if (!account) {
    return null;
  }
  return {
    id: account.id,
    displayName: account.displayName,
    douyinId: account.douyinId,
    loginStatus: account.loginStatus,
    isSyncing,
    lastSyncAt: account.lastSyncAt,
    lastError: account.lastError,
    archivedAt: account.archivedAt
  };
}

export function registerV2Routes(app: FastifyInstance, db: AppDatabase, scraper: ScraperService, autoSync: AutoSyncService) {
  const statistics = new StatisticsService(db);

  app.get("/api/v2/dashboard/summary", async () => statistics.getDashboardSummary());

  app.get("/api/v2/dashboard/trend", async (request, reply) => {
    const query = request.query as { days?: string; from?: string; to?: string };
    try {
      const options: { days?: number; from?: string; to?: string } = {};
      if (query.days !== undefined) options.days = Number(query.days);
      if (query.from !== undefined) options.from = query.from;
      if (query.to !== undefined) options.to = query.to;
      return statistics.getDashboardTrend(options);
    } catch (error) {
      return reply.status(400).send({ message: error instanceof Error ? error.message : "趋势参数无效" });
    }
  });

  app.get("/api/v2/dashboard/ranking", async () => {
    const tasks = db.listTaskVideoRows({})
      .sort((left, right) => (right.todayPredictedDelta ?? -Infinity) - (left.todayPredictedDelta ?? -Infinity));
    const accounts = new Map<string, { accountId: string; accountName: string; dailyIncrease: number }>();
    for (const task of tasks) {
      const current = accounts.get(task.accountId) ?? { accountId: task.accountId, accountName: task.accountName, dailyIncrease: 0 };
      current.dailyIncrease += task.todayPredictedDelta ?? 0;
      accounts.set(task.accountId, current);
    }
    return { tasks: tasks.slice(0, 10), accounts: [...accounts.values()].sort((left, right) => right.dailyIncrease - left.dailyIncrease).slice(0, 10) };
  });

  app.get("/api/v2/accounts", async (request) => {
    const query = request.query as { archived?: string };
    const includeArchived = query.archived === "true";
    return db.listAccounts({ includeArchived }).map((account) => accountPayload(account, scraper.isSyncing(account.id)));
  });

  app.post("/api/v2/accounts", async (request, reply) => {
    try {
      return accountPayload(db.createAccount(readText(request.body, "displayName")));
    } catch (error) {
      return reply.status(400).send({ message: error instanceof Error ? error.message : "参数错误" });
    }
  });

  app.post("/api/v2/accounts/:accountId/login", async (request, reply) => {
    try {
      await scraper.launchLogin((request.params as { accountId: string }).accountId);
      return { status: "login_started" };
    } catch (error) {
      return reply.status(400).send({ message: error instanceof Error ? error.message : "登录启动失败" });
    }
  });

  app.post("/api/v2/accounts/:accountId/sync", async (request, reply) => {
    try {
      await scraper.syncAccount((request.params as { accountId: string }).accountId);
      return { status: "synced" };
    } catch (error) {
      return reply.status(400).send({ message: error instanceof Error ? error.message : "同步失败" });
    }
  });

  app.patch("/api/v2/accounts/:accountId/archive", async (request, reply) => {
    try {
      db.deleteAccount((request.params as { accountId: string }).accountId);
      return { status: "archived" };
    } catch (error) {
      return reply.status(400).send({ message: error instanceof Error ? error.message : "归档账号失败" });
    }
  });

  app.get("/api/v2/tasks", async (request) => {
    const query = request.query as { accountId?: string; status?: string };
    const filters: { accountId?: string; status?: string } = {};
    if (query.accountId) {
      filters.accountId = query.accountId;
    }
    if (query.status) {
      filters.status = query.status;
    }
    return db.listTaskVideoRows(filters);
  });

  app.get("/api/v2/tasks/:taskId", async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    const task = db.listTaskVideoRows({}).find((item) => item.taskId === taskId);
    return task ?? reply.status(404).send({ message: "任务不存在" });
  });

  app.post("/api/v2/tasks/:taskId/video-link", async (request, reply) => {
    try {
      db.saveManualLink((request.params as { taskId: string }).taskId, readText(request.body, "videoId"));
      return { status: "bound" };
    } catch (error) {
      return reply.status(400).send({ message: error instanceof Error ? error.message : "绑定失败" });
    }
  });

  app.get("/api/v2/sync/status", async () => autoSync.getStatus());
  app.post("/api/v2/sync/run-all", async () => autoSync.requestManualFullSync());
}
