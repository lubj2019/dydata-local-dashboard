import assert from "node:assert/strict";
import test from "node:test";
import type { XingtuTaskRecord } from "../domain/types.js";
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
    dailyIncrease: 3
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
    dailyIncrease: 5
  });
  db.deleteAccount(account.id);
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
