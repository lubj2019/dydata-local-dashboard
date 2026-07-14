import type { FastifyInstance } from "fastify";
import { AppDatabase } from "../services/db.js";

function readVideoId(body: unknown): string {
  if (!body || typeof body !== "object" || typeof (body as { videoId?: unknown }).videoId !== "string") {
    throw new Error("videoId 必填");
  }

  const videoId = (body as { videoId: string }).videoId.trim();
  if (!videoId) {
    throw new Error("videoId 必填");
  }

  return videoId;
}

export function registerTaskVideoRoutes(app: FastifyInstance, db: AppDatabase) {
  app.get("/api/daily-estimate-summary", async () => db.getDailyEstimateSummary());

  app.get("/api/task-videos", async (request) => {
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

  app.post("/api/task-links/:taskId/bind", async (request, reply) => {
    try {
      const taskId = (request.params as { taskId: string }).taskId;
      const videoId = readVideoId(request.body);
      db.saveManualLink(taskId, videoId);
      return { status: "bound" };
    } catch (error) {
      return reply.status(400).send({ message: error instanceof Error ? error.message : "绑定失败" });
    }
  });
}
