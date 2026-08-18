import assert from "node:assert/strict";
import test from "node:test";
import type { VideoRecord, XingtuTaskRecord } from "../domain/types.js";
import { getShanghaiDateKey } from "../domain/dailyEstimate.js";
import { getPreviousDateKey } from "../domain/dailyEstimate.js";
import { AppDatabase } from "../services/db.js";
import { buildScopedTaskId, parseMissionEstimatedAmount } from "../services/scraper.js";

function task(
  accountId: string,
  id: string,
  missionId: string,
  predictedAmount: number
): XingtuTaskRecord {
  return {
    id,
    missionId,
    accountId,
    taskName: missionId,
    videoTitle: id,
    coverUrl: null,
    publishedAt: null,
    xingtuPlayCount: null,
    predictedAmount,
    missionEstimatedAmount: predictedAmount,
    settledAmount: null,
    taskStatus: "in_progress",
    sourceUrl: null
  };
}

function video(accountId: string, id: string, actualPlayCount: number | null): VideoRecord {
  return {
    id,
    accountId,
    title: id,
    coverUrl: null,
    publishedAt: "2026-07-20T00:00:00.000Z",
    actualPlayCount,
    videoStatus: "published",
    sourceUrl: null
  };
}

function playPayload(accountId: string, taskId: string, actualPlayCount: number | null) {
  return playPayloads(accountId, [[taskId, actualPlayCount]]);
}

function playPayloads(accountId: string, entries: ReadonlyArray<readonly [string, number | null]>) {
  const links = entries.map(([taskId]) => ({ taskId, videoId: `video-${taskId}` }));
  return {
    tasks: entries.map(([taskId]) => task(accountId, taskId, `mission-${taskId}`, 0)),
    videos: entries.map(([taskId, actualPlayCount]) => video(accountId, `video-${taskId}`, actualPlayCount)),
    links
  };
}

test("daily estimate delta compares with yesterday and treats a new task as zero baseline", () => {
  const db = new AppDatabase(":memory:");
  const account = db.createAccount("测试账号");
  const oldTask = task(account.id, "task-old", "mission-old", 10);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  db.replaceAccountSyncData(
    account.id,
    { tasks: [oldTask], videos: [], links: [] },
    yesterday
  );
  db.replaceAccountSyncData(
    account.id,
    {
      tasks: [
        { ...oldTask, predictedAmount: 15 },
        task(account.id, "task-new", "mission-new", 2)
      ],
      videos: [],
      links: []
    },
    today
  );

  const rows = db.listTaskVideoRows({ accountId: account.id });
  const oldRow = rows.find((row) => row.taskId === "task-old");
  const newRow = rows.find((row) => row.taskId === "task-new");

  assert.equal(oldRow?.yesterdayPredictedAmount, 10);
  assert.equal(oldRow?.todayPredictedDelta, 5);
  assert.equal(newRow?.yesterdayPredictedAmount, 0);
  assert.equal(newRow?.todayPredictedDelta, 2);
  db.deleteAccount(account.id);
});

test("task video rows retain the task-detail estimated income instead of a video commission total", () => {
  const db = new AppDatabase(":memory:");
  const account = db.createAccount("task estimate account");
  const missionId = "mission-detail";

  db.replaceAccountSyncData(account.id, {
    tasks: [
      { ...task(account.id, "task-video-1", missionId, 2.17), missionEstimatedAmount: 64.52 },
      { ...task(account.id, "task-video-2", missionId, 16.67), missionEstimatedAmount: 64.52 }
    ],
    videos: [],
    links: []
  });

  const rows = db.listTaskVideoRows({ accountId: account.id });
  assert.deepEqual(rows.map((row) => row.missionEstimatedAmount), [64.52, 64.52]);
  db.deleteAccount(account.id);
});

test("task-detail summary reward amount uses the same thousandth unit as the rendered estimate", () => {
  assert.equal(
    parseMissionEstimatedAmount({ progress: { reward_amount: "24220" } }),
    24.22
  );
  assert.equal(
    parseMissionEstimatedAmount({ progress: { bill_detail: { "3000": "64520" } } }),
    64.52
  );
});

test("daily estimate delta also works from the first sync of the current day", () => {
  const db = new AppDatabase(":memory:");
  const account = db.createAccount("当天更新账号");
  const today = new Date();
  const taskAtOpening = task(account.id, "task-today", "mission-today", 10);

  db.replaceAccountSyncData(account.id, { tasks: [taskAtOpening], videos: [], links: [] }, today);
  db.replaceAccountSyncData(
    account.id,
    { tasks: [{ ...taskAtOpening, predictedAmount: 15 }], videos: [], links: [] },
    new Date(today.getTime() + 60 * 1000)
  );

  const row = db.listTaskVideoRows({ accountId: account.id })[0];
  assert.equal(row?.yesterdayPredictedAmount, null);
  assert.equal(row?.todayPredictedDelta, 5);
  db.deleteAccount(account.id);
});

test("daily estimate summary uses each account's final snapshot of yesterday", () => {
  const db = new AppDatabase(":memory:");
  const account = db.createAccount("summary account");
  const today = new Date();
  const yesterdayMorning = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayEvening = new Date(yesterdayMorning.getTime() + 60 * 60 * 1000);

  db.replaceAccountSyncData(
    account.id,
    {
      tasks: [
        task(account.id, "task-remaining", "mission-remaining", 10),
        task(account.id, "task-finished", "mission-finished", 5)
      ],
      videos: [],
      links: []
    },
    yesterdayMorning
  );
  db.replaceAccountSyncData(
    account.id,
    {
      tasks: [task(account.id, "task-remaining", "mission-remaining", 12)],
      videos: [],
      links: []
    },
    yesterdayEvening
  );
  db.replaceAccountSyncData(
    account.id,
    {
      tasks: [
        task(account.id, "task-remaining", "mission-remaining", 12),
        task(account.id, "task-new", "mission-new", 3)
      ],
      videos: [],
      links: []
    },
    today
  );

  assert.deepEqual(db.getDailyEstimateSummary(today), {
    yesterdayEstimatedTotal: 12,
    todayEstimatedTotal: 15,
    dailyIncrease: 3,
    snapshotDate: getPreviousDateKey(today),
    expectedAccountCount: 0,
    freshAccountCount: 0,
    carriedForwardAccountCount: 0,
    missingAccountCount: 0,
    isComplete: true
  });
  db.deleteAccount(account.id);
});

test("daily estimate summary uses the same task estimate shown in the ranking", () => {
  const db = new AppDatabase(":memory:");
  const account = db.createAccount("summary ranking account");
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const taskRecord = {
    ...task(account.id, "task-ranking", "mission-ranking", 10),
    missionEstimatedAmount: 10
  };

  db.replaceAccountSyncData(account.id, { tasks: [taskRecord], videos: [], links: [] }, yesterday);
  db.replaceAccountSyncData(
    account.id,
    {
      tasks: [
        {
          ...taskRecord,
          predictedAmount: 12,
          missionEstimatedAmount: 15
        }
      ],
      videos: [],
      links: []
    },
    today
  );

  assert.deepEqual(db.getDailyEstimateSummary(today), {
    yesterdayEstimatedTotal: 10,
    todayEstimatedTotal: 15,
    dailyIncrease: 5,
    snapshotDate: getPreviousDateKey(today),
    expectedAccountCount: 0,
    freshAccountCount: 0,
    carriedForwardAccountCount: 0,
    missingAccountCount: 0,
    isComplete: true
  });
  db.deleteAccount(account.id);
});

test("archived account data remains in estimates but is hidden from detail views", () => {
  const db = new AppDatabase(":memory:");
  const account = db.createAccount("archived estimate account");
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const taskId = "archived-estimate-task";

  db.replaceAccountSyncData(
    account.id,
    { tasks: [task(account.id, taskId, "archived-estimate-mission", 10)], videos: [], links: [] },
    yesterday
  );
  db.replaceAccountSyncData(
    account.id,
    {
      tasks: [{ ...task(account.id, taskId, "archived-estimate-mission", 15), missionEstimatedAmount: 15 }],
      videos: [],
      links: []
    },
    today
  );

  db.deleteAccount(account.id);

  assert.equal(db.listTaskVideoRows({}).length, 0);
  assert.equal(db.listTaskPlayGrowthPage(1, 50, today).total, 0);
  assert.deepEqual(db.getDailyEstimateSummary(today), {
    yesterdayEstimatedTotal: 10,
    todayEstimatedTotal: 15,
    dailyIncrease: 5,
    snapshotDate: getPreviousDateKey(today),
    expectedAccountCount: 0,
    freshAccountCount: 0,
    carriedForwardAccountCount: 0,
    missingAccountCount: 0,
    isComplete: true
  });
});

test("ranking baseline only compares the same account and task", () => {
  const db = new AppDatabase(":memory:");
  const account = db.createAccount("ranking account");
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const existing = task(account.id, "task-existing", "mission-existing", 10);

  db.replaceAccountSyncData(account.id, { tasks: [existing], videos: [], links: [] }, yesterday);
  db.replaceAccountSyncData(
    account.id,
    {
      tasks: [
        { ...existing, predictedAmount: 12, missionEstimatedAmount: 12 },
        task(account.id, "task-new", "mission-new", 3)
      ],
      videos: [],
      links: []
    },
    today
  );

  const rows = db.listTaskVideoRows({ accountId: account.id });
  const existingRow = rows.find((row) => row.taskId === existing.id);
  const newRow = rows.find((row) => row.taskId === "task-new");

  assert.equal(existingRow?.hasYesterdayTaskBaseline, 1);
  assert.equal(existingRow?.yesterdayTaskPredictedAmount, 10);
  assert.equal(newRow?.hasYesterdayTaskBaseline, 0);
  assert.equal(newRow?.yesterdayTaskPredictedAmount, null);
  db.deleteAccount(account.id);
});

test("accounts can sync the same Xingtu mission video without task ID conflicts", async () => {
  const db = new AppDatabase(":memory:");
  const firstAccount = db.createAccount("account one");
  await new Promise((resolve) => setTimeout(resolve, 1));
  const secondAccount = db.createAccount("account two");
  const missionId = "mission-shared";
  const videoId = "video-shared";

  db.replaceAccountSyncData(firstAccount.id, {
    tasks: [task(firstAccount.id, buildScopedTaskId(firstAccount.id, missionId, videoId), missionId, 10)],
    videos: [],
    links: []
  });
  db.replaceAccountSyncData(secondAccount.id, {
    tasks: [task(secondAccount.id, buildScopedTaskId(secondAccount.id, missionId, videoId), missionId, 20)],
    videos: [],
    links: []
  });

  assert.equal(db.listTasksByAccount(firstAccount.id).length, 1);
  assert.equal(db.listTasksByAccount(secondAccount.id).length, 1);
  db.deleteAccount(firstAccount.id);
  db.deleteAccount(secondAccount.id);
});

test("play growth uses the previous sync and the final snapshot from the prior Shanghai day", () => {
  const db = new AppDatabase(":memory:");
  const account = db.createAccount("play growth account");
  const taskId = "play-growth-task";
  const yesterdayMorning = new Date("2026-07-19T01:00:00.000Z");
  const yesterdayEvening = new Date("2026-07-19T12:00:00.000Z");
  const todayMorning = new Date("2026-07-20T01:00:00.000Z");
  const todayCurrent = new Date("2026-07-20T03:00:00.000Z");

  db.replaceAccountSyncData(account.id, playPayload(account.id, taskId, 100), yesterdayMorning);
  db.replaceAccountSyncData(account.id, playPayload(account.id, taskId, 120), yesterdayEvening);
  db.replaceAccountSyncData(account.id, playPayload(account.id, taskId, 140), todayMorning);
  db.replaceAccountSyncData(account.id, playPayload(account.id, taskId, 150), todayCurrent);

  const row = db.listTaskPlayGrowthPage(1, 50, todayCurrent).items[0];
  assert.equal(row?.actualPlayCount, 150);
  assert.equal(row?.playGrowth, 10);
  assert.equal(row?.dailyPlayGrowth, 30);
  db.deleteAccount(account.id);
});

test("play growth leaves missing baselines and current play counts empty", () => {
  const db = new AppDatabase(":memory:");
  const account = db.createAccount("missing play baseline account");
  const now = new Date("2026-07-20T03:00:00.000Z");

  db.replaceAccountSyncData(
    account.id,
    playPayloads(account.id, [
      ["new-play-task", 25],
      ["no-play-task", null]
    ]),
    now
  );

  const rows = db.listTaskPlayGrowthPage(1, 50, now).items;
  const newRow = rows.find((row) => row.taskName === "mission-new-play-task");
  const noPlayRow = rows.find((row) => row.taskName === "mission-no-play-task");
  assert.equal(newRow?.actualPlayCount, 25);
  assert.equal(newRow?.playGrowth, null);
  assert.equal(newRow?.dailyPlayGrowth, null);
  assert.equal(noPlayRow?.actualPlayCount, null);
  assert.equal(noPlayRow?.playGrowth, null);
  assert.equal(noPlayRow?.dailyPlayGrowth, null);
  db.deleteAccount(account.id);
});

test("daily video play growth is unique, baseline-aware, and excludes archived accounts", () => {
  const db = new AppDatabase(":memory:");
  const account = db.createAccount("daily video growth account");
  const archived = db.createAccount("archived video growth account");
  const yesterday = new Date("2026-07-19T12:00:00.000Z");
  const today = new Date("2026-07-20T03:00:00.000Z");
  const sharedVideo = video(account.id, "video-shared", 130);
  const currentOnlyVideo = video(account.id, "video-current-only", 50);
  const sharedTasks = [
    { ...task(account.id, "task-a", "mission-a", 0), xingtuPlayCount: 100 },
    { ...task(account.id, "task-b", "mission-b", 0), xingtuPlayCount: 80 }
  ];
  const sharedLinks = [
    { taskId: "task-a", videoId: sharedVideo.id },
    { taskId: "task-b", videoId: sharedVideo.id }
  ];

  db.replaceAccountSyncData(archived.id, playPayload(archived.id, "archived-task", 100), yesterday);
  db.updateAccountStatus(archived.id, { loginStatus: "active", lastSyncAt: yesterday.toISOString() });
  db.replaceAccountSyncData(account.id, {
    tasks: sharedTasks,
    videos: [{ ...sharedVideo, actualPlayCount: 100 }],
    links: sharedLinks
  }, yesterday);
  db.updateAccountStatus(account.id, { loginStatus: "active", lastSyncAt: yesterday.toISOString() });
  db.finalizeDailySnapshots(getShanghaiDateKey(yesterday), yesterday);
  db.replaceAccountSyncData(account.id, {
    tasks: sharedTasks,
    videos: [sharedVideo, currentOnlyVideo],
    links: sharedLinks
  }, today);
  db.updateAccountStatus(account.id, { loginStatus: "active", lastSyncAt: today.toISOString() });

  db.finalizeDailySnapshots(getShanghaiDateKey(yesterday), yesterday);
  db.replaceAccountSyncData(archived.id, playPayload(archived.id, "archived-task", 160), today);
  db.updateAccountStatus(archived.id, { loginStatus: "active", lastSyncAt: today.toISOString() });
  db.deleteAccount(archived.id);

  const rows = db.listVideoPlayGrowthRows(today);
  const sharedRow = rows.find((row) => row.videoId === "video-shared");
  const currentOnlyRow = rows.find((row) => row.videoId === "video-current-only");
  const taskRow = db.listTaskVideoRows({}, today).find((row) => row.taskId === "task-a");
  assert.equal(rows.length, 2);
  assert.equal(sharedRow?.taskName, "mission-a,mission-b");
  assert.equal(sharedRow?.playDelta, 50);
  assert.equal(currentOnlyRow?.taskName, null);
  assert.equal(currentOnlyRow?.playDelta, null);
  assert.equal(sharedRow?.dailyPlayGrowth, 30);
  assert.equal(currentOnlyRow?.dailyPlayGrowth, null);
  assert.equal(taskRow?.yesterdayActualPlayCount, 100);
  assert.equal(taskRow?.dailyPlayGrowth, 30);
  assert.deepEqual(db.getDailyPlayGrowthSummary(today), {
    dailyPlayGrowth: 30,
    dailyPlayGrowthCoverage: {
      totalVideos: 2,
      eligibleVideos: 1,
      baselineDate: "2026-07-19"
    }
  });
  assert.equal(rows.some((row) => row.accountName === "archived video growth account"), false);
  db.deleteAccount(account.id);
});

test("play growth pagination is sorted by growth since the previous sync and clamps out-of-range pages", () => {
  const db = new AppDatabase(":memory:");
  const account = db.createAccount("play growth pagination account");
  const yesterday = new Date("2026-07-19T12:00:00.000Z");
  const todayFirstSync = new Date("2026-07-20T01:00:00.000Z");
  const today = new Date("2026-07-20T03:00:00.000Z");

  const yesterdayPlays = [
    ["task-low", 100],
    ["task-high", 100],
    ["task-mid", 100]
  ] as const;
  const firstSyncPlays = [
    ["task-low", 200],
    ["task-high", 120],
    ["task-mid", 130]
  ] as const;
  const currentPlays = [
    ["task-low", 201],
    ["task-high", 160],
    ["task-mid", 150]
  ] as const;
  db.replaceAccountSyncData(account.id, playPayloads(account.id, yesterdayPlays), yesterday);
  db.replaceAccountSyncData(account.id, playPayloads(account.id, firstSyncPlays), todayFirstSync);
  db.replaceAccountSyncData(account.id, playPayloads(account.id, currentPlays), today);

  const firstPage = db.listTaskPlayGrowthPage(1, 2, today);
  const lastPage = db.listTaskPlayGrowthPage(99, 2, today);
  assert.equal(firstPage.total, 3);
  assert.deepEqual(firstPage.items.map((row) => row.playGrowth), [40, 20]);
  assert.equal(lastPage.page, 2);
  assert.deepEqual(lastPage.items.map((row) => row.playGrowth), [1]);
  db.deleteAccount(account.id);
});

test("daily finalization stores a complete immutable fresh snapshot", () => {
  const db = new AppDatabase(":memory:");
  const account = db.createAccount("日结账号");
  const syncedAt = new Date();
  const payload = playPayload(account.id, "task-daily", 123);

  db.replaceAccountSyncData(account.id, payload, syncedAt);
  db.updateAccountStatus(account.id, { loginStatus: "active", lastSyncAt: syncedAt.toISOString() });

  const snapshotDate = getShanghaiDateKey(syncedAt);
  assert.deepEqual(db.finalizeDailySnapshots(snapshotDate, syncedAt), {
    expected: 1,
    fresh: 1,
    carriedForward: 0,
    missing: 0
  });
  assert.deepEqual(db.getDailySnapshot(account.id, snapshotDate), {
    id: `${account.id}:${snapshotDate}`,
    status: "fresh",
    sourceSnapshotId: `current:${account.id}:${syncedAt.toISOString()}`,
    sourceSyncedAt: syncedAt.toISOString(),
    capturedAt: syncedAt.toISOString(),
    lastError: null,
    taskCount: 1,
    videoCount: 1,
    linkCount: 1
  });

  const retry = new Date(syncedAt.getTime() + 60_000);
  assert.deepEqual(db.finalizeDailySnapshots(snapshotDate, retry), {
    expected: 1,
    fresh: 0,
    carriedForward: 0,
    missing: 0
  });
  assert.equal(db.getDailySnapshot(account.id, snapshotDate)?.capturedAt, syncedAt.toISOString());
  db.deleteAccount(account.id);
});

test("daily finalization carries the last snapshot and records missing history", () => {
  const db = new AppDatabase(":memory:");
  const syncedAt = new Date();
  const todayDate = getShanghaiDateKey(syncedAt);
  const nextDate = getShanghaiDateKey(new Date(syncedAt.getTime() + 24 * 60 * 60 * 1000));
  const carriedAccount = db.createAccount("沿用账号");
  const missingAccount = db.createAccount("缺失账号");

  db.replaceAccountSyncData(carriedAccount.id, playPayload(carriedAccount.id, "task-carry", 10), syncedAt);
  db.updateAccountStatus(carriedAccount.id, { loginStatus: "active", lastSyncAt: syncedAt.toISOString() });
  db.updateAccountStatus(missingAccount.id, { loginStatus: "active" });
  db.finalizeDailySnapshots(todayDate, syncedAt);

  assert.deepEqual(db.finalizeDailySnapshots(nextDate, new Date(syncedAt.getTime() + 24 * 60 * 60 * 1000)), {
    expected: 2,
    fresh: 0,
    carriedForward: 1,
    missing: 1
  });
  assert.equal(db.getDailySnapshot(carriedAccount.id, nextDate)?.status, "carried_forward");
  assert.equal(db.getDailySnapshot(carriedAccount.id, nextDate)?.taskCount, 1);
  assert.equal(db.getDailySnapshot(missingAccount.id, nextDate)?.status, "missing");
  assert.deepEqual(db.getDailySnapshotCoverage(nextDate), {
    expected: 2,
    fresh: 0,
    carriedForward: 1,
    missing: 1
  });

  db.deleteAccount(carriedAccount.id);
  assert.ok(db.getDailySnapshot(carriedAccount.id, todayDate));
  assert.equal(db.listAccounts().some((account) => account.id === carriedAccount.id), false);
  assert.ok(db.listAccounts({ includeArchived: true }).find((account) => account.id === carriedAccount.id)?.archivedAt);
  db.deleteAccount(missingAccount.id);
});

test("daily finalization includes archived accounts and carries them forward", () => {
  const db = new AppDatabase(":memory:");
  const account = db.createAccount("archived snapshot account");
  const syncedAt = new Date();
  const todayDate = getShanghaiDateKey(syncedAt);
  const nextDate = getShanghaiDateKey(new Date(syncedAt.getTime() + 24 * 60 * 60 * 1000));

  db.replaceAccountSyncData(account.id, {
    tasks: [task(account.id, "archived-snapshot-task", "archived-snapshot-mission", 12)],
    videos: [],
    links: []
  }, syncedAt);
  db.updateAccountStatus(account.id, { loginStatus: "active", lastSyncAt: syncedAt.toISOString() });
  db.deleteAccount(account.id);

  assert.deepEqual(db.finalizeDailySnapshots(todayDate, syncedAt), {
    expected: 1,
    fresh: 1,
    carriedForward: 0,
    missing: 0
  });
  assert.deepEqual(db.finalizeDailySnapshots(nextDate, new Date(syncedAt.getTime() + 24 * 60 * 60 * 1000)), {
    expected: 1,
    fresh: 0,
    carriedForward: 1,
    missing: 0
  });
  assert.equal(db.getDailySnapshot(account.id, nextDate)?.taskCount, 1);
  assert.deepEqual(db.getDailySnapshotCoverage(nextDate), {
    expected: 1,
    fresh: 0,
    carriedForward: 1,
    missing: 0
  });
});

test("estimate summary falls back to an archived account's last valid snapshot", () => {
  const db = new AppDatabase(":memory:");
  const account = db.createAccount("archived snapshot fallback account");
  const syncedAt = new Date("2026-08-05T04:00:00.000Z");
  const snapshotDate = getShanghaiDateKey(syncedAt);

  db.replaceAccountSyncData(account.id, {
    tasks: [task(account.id, "archived-fallback-task", "archived-fallback-mission", 12)],
    videos: [],
    links: []
  }, syncedAt);
  db.updateAccountStatus(account.id, { loginStatus: "active", lastSyncAt: syncedAt.toISOString() });
  db.finalizeDailySnapshots(snapshotDate, syncedAt);
  db.deleteAccount(account.id);

  const rawDb = (db as unknown as { db: { prepare(sql: string): { run(...params: string[]): void } } }).db;
  rawDb.prepare(`DELETE FROM xingtu_tasks WHERE account_id = ?`).run(account.id);

  assert.deepEqual(db.getDailyEstimateSummary(new Date("2026-08-08T04:00:00.000Z")), {
    yesterdayEstimatedTotal: 12,
    todayEstimatedTotal: 12,
    dailyIncrease: 0,
    snapshotDate: "2026-08-07",
    expectedAccountCount: 1,
    freshAccountCount: 0,
    carriedForwardAccountCount: 1,
    missingAccountCount: 0,
    isComplete: true
  });
});
