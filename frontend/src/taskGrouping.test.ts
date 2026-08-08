import assert from "node:assert/strict";
import test from "node:test";
import type { TaskVideoRow } from "./types.js";
import { groupTaskRows } from "./taskGrouping.js";

function row(overrides: Partial<TaskVideoRow> = {}): TaskVideoRow {
  return {
    taskId: "task-1",
    missionId: "mission-1",
    videoId: "video-1",
    accountId: "account-1",
    accountName: "Account 1",
    taskName: "Mission 1",
    videoTitle: "Video 1",
    publishedAt: null,
    xingtuPlayCount: 10,
    actualPlayCount: 12,
    playDelta: 2,
    predictedAmount: 4,
    missionEstimatedAmount: 20,
    yesterdayPredictedAmount: null,
    yesterdayTaskPredictedAmount: 8,
    hasYesterdayTaskBaseline: 1,
    todayPredictedDelta: 3,
    settledAmount: 1,
    videoStatus: "published",
    taskStatus: "in_progress",
    lastSyncedAt: null,
    matchSource: "auto",
    ...overrides
  };
}

test("groups videos by account and mission while summing video metrics", () => {
  const groups = groupTaskRows([
    row(),
    row({ taskId: "task-2", videoId: "video-2", videoTitle: "Video 2", xingtuPlayCount: 20, actualPlayCount: 25, playDelta: 5, todayPredictedDelta: 4, settledAmount: 2 })
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.videos.length, 2);
  assert.equal(groups[0]?.taskEstimate, 20);
  assert.equal(groups[0]?.yesterdayTaskPredictedAmount, 8);
  assert.equal(groups[0]?.todayPredictedDelta, 7);
  assert.equal(groups[0]?.xingtuPlayCount, 30);
  assert.equal(groups[0]?.actualPlayCount, 37);
  assert.equal(groups[0]?.playDelta, 7);
  assert.equal(groups[0]?.settledAmount, 3);
});

test("does not merge different accounts or missions", () => {
  const groups = groupTaskRows([
    row(),
    row({ taskId: "task-2", accountId: "account-2", accountName: "Account 2" }),
    row({ taskId: "task-3", missionId: "mission-2" })
  ]);

  assert.equal(groups.length, 3);
});
