import assert from "node:assert/strict";
import test from "node:test";
import type { XingtuTaskRecord } from "../domain/types.js";
import { AppDatabase } from "../services/db.js";
import { StatisticsService } from "../services/statistics.js";

function task(accountId: string, id: string, amount: number): XingtuTaskRecord {
  return {
    id,
    missionId: id,
    accountId,
    taskName: id,
    videoTitle: null,
    coverUrl: null,
    publishedAt: null,
    xingtuPlayCount: null,
    predictedAmount: amount,
    missionEstimatedAmount: amount,
    settledAmount: null,
    taskStatus: "in_progress",
    sourceUrl: null
  };
}

test("dashboard summary uses the realtime amount, final yesterday snapshot, and a shared delta", () => {
  const db = new AppDatabase(":memory:");
  const account = db.createAccount("统计账号");
  const yesterday = new Date("2026-08-06T04:00:00.000Z");
  const now = new Date("2026-08-07T04:00:00.000Z");

  db.replaceAccountSyncData(account.id, { tasks: [task(account.id, "task", 10)], videos: [], links: [] }, yesterday);
  db.updateAccountStatus(account.id, { loginStatus: "active", lastSyncAt: yesterday.toISOString() });
  db.finalizeDailySnapshots("2026-08-06", yesterday);
  db.replaceAccountSyncData(account.id, { tasks: [task(account.id, "task", 15)], videos: [], links: [] }, now);
  db.updateAccountStatus(account.id, { loginStatus: "active", lastSyncAt: now.toISOString() });

  const summary = new StatisticsService(db).getDashboardSummary(now);
  assert.equal(summary.realtimeEstimatedTotal, 15);
  assert.equal(summary.yesterdayFinalEstimatedTotal, 10);
  assert.equal(summary.dailyIncrease, 5);
  assert.equal(summary.snapshot.isComplete, true);
  assert.equal(summary.accounts.activeCount, 1);
});

test("dashboard summary retains archived account totals while keeping it out of active exceptions", () => {
  const db = new AppDatabase(":memory:");
  const account = db.createAccount("归档统计账号");
  const syncedAt = new Date("2026-08-06T04:00:00.000Z");
  const now = new Date("2026-08-08T04:00:00.000Z");

  db.replaceAccountSyncData(account.id, { tasks: [task(account.id, "task", 12)], videos: [], links: [] }, syncedAt);
  db.updateAccountStatus(account.id, { loginStatus: "active", lastSyncAt: syncedAt.toISOString() });
  db.finalizeDailySnapshots("2026-08-06", syncedAt);
  db.deleteAccount(account.id);
  const rawDb = (db as unknown as { db: { prepare(sql: string): { run(...params: string[]): void } } }).db;
  rawDb.prepare("DELETE FROM xingtu_tasks WHERE account_id = ?").run(account.id);

  const summary = new StatisticsService(db).getDashboardSummary(now);
  assert.equal(summary.realtimeEstimatedTotal, 12);
  assert.equal(summary.accounts.activeCount, 0);
  assert.equal(summary.accounts.exceptionCount, 0);
  assert.equal(summary.snapshot.missingAccountCount, 0);
});

test("dashboard summary returns missing accounts instead of silently treating them as zero", () => {
  const db = new AppDatabase(":memory:");
  const account = db.createAccount("缺失账号");
  const yesterday = new Date("2026-08-06T04:00:00.000Z");
  const now = new Date("2026-08-07T04:00:00.000Z");

  db.updateAccountStatus(account.id, { loginStatus: "active", lastSyncAt: yesterday.toISOString() });
  const summary = new StatisticsService(db).getDashboardSummary(now);
  assert.equal(summary.snapshot.isComplete, false);
  assert.equal(summary.snapshot.missingAccountCount, 1);
  assert.equal(summary.snapshot.missingAccounts[0]?.displayName, "缺失账号");
  assert.equal(summary.accounts.pendingSyncCount, 1);
});

test("dashboard summary includes newly logged-in accounts in operations without making them yesterday snapshot gaps", () => {
  const db = new AppDatabase(":memory:");
  const account = db.createAccount("新账号");
  const now = new Date("2026-08-07T04:00:00.000Z");

  db.updateAccountStatus(account.id, { loginStatus: "active" });
  const summary = new StatisticsService(db).getDashboardSummary(now);
  assert.equal(summary.accounts.activeCount, 1);
  assert.equal(summary.accounts.pendingSyncCount, 1);
  assert.equal(summary.snapshot.missingAccountCount, 0);
});

test("dashboard trend carries the last usable snapshot across dates", () => {
  const db = new AppDatabase(":memory:");
  const account = db.createAccount("趋势账号");
  const firstSync = new Date("2026-08-04T04:00:00.000Z");
  const latestSync = new Date("2026-08-06T04:00:00.000Z");

  db.replaceAccountSyncData(account.id, { tasks: [task(account.id, "task", 10)], videos: [], links: [] }, firstSync);
  db.updateAccountStatus(account.id, { loginStatus: "active", lastSyncAt: firstSync.toISOString() });
  db.finalizeDailySnapshots("2026-08-04", firstSync);
  db.finalizeDailySnapshots("2026-08-05", new Date("2026-08-05T04:00:00.000Z"));
  db.replaceAccountSyncData(account.id, { tasks: [task(account.id, "task", 15)], videos: [], links: [] }, latestSync);
  db.updateAccountStatus(account.id, { loginStatus: "active", lastSyncAt: latestSync.toISOString() });
  db.finalizeDailySnapshots("2026-08-06", latestSync);

  const trend = new StatisticsService(db).getDashboardTrend({ from: "2026-08-04", to: "2026-08-06" });
  assert.deepEqual(trend.points.map((point) => point.total), [10, 10, 15]);
  assert.deepEqual(trend.points.map((point) => point.isComplete), [true, true, true]);
  assert.equal(trend.points[1]?.carriedForwardAccountCount, 1);
  assert.equal(trend.points[2]?.freshAccountCount, 1);
});
