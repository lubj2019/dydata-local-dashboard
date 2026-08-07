import assert from "node:assert/strict";
import test from "node:test";
import type { TaskVideoRow } from "./types.js";
import { nextVideoSort, sortVideoRows } from "./videoSorting.js";

function row(id: string, actualPlayCount: number | null, playDelta: number | null, publishedAt: string | null): TaskVideoRow {
  return {
    taskId: id,
    missionId: id,
    videoId: id,
    accountId: "account",
    accountName: "account",
    taskName: id,
    videoTitle: id,
    publishedAt,
    xingtuPlayCount: null,
    actualPlayCount,
    playDelta,
    predictedAmount: null,
    missionEstimatedAmount: null,
    yesterdayPredictedAmount: null,
    yesterdayTaskPredictedAmount: null,
    hasYesterdayTaskBaseline: 0,
    todayPredictedDelta: null,
    settledAmount: null,
    videoStatus: null,
    taskStatus: "unknown",
    lastSyncedAt: null,
    matchSource: null
  };
}

test("video sorting toggles a column between descending and ascending", () => {
  const descending = nextVideoSort(null, "actualPlayCount");
  assert.deepEqual(descending, { key: "actualPlayCount", direction: "desc" });
  assert.deepEqual(nextVideoSort(descending, "actualPlayCount"), { key: "actualPlayCount", direction: "asc" });
});

test("video sorting orders numeric and publication fields while keeping missing values last", () => {
  const rows = [
    row("a", 12, -2, "2026-06-02T00:00:00.000Z"),
    row("b", null, null, null),
    row("c", 50, 4, "2026-06-03T00:00:00.000Z")
  ];

  assert.deepEqual(sortVideoRows(rows, { key: "actualPlayCount", direction: "desc" }).map((item) => item.taskId), ["c", "a", "b"]);
  assert.deepEqual(sortVideoRows(rows, { key: "playDelta", direction: "asc" }).map((item) => item.taskId), ["a", "c", "b"]);
  assert.deepEqual(sortVideoRows(rows, { key: "publishedAt", direction: "asc" }).map((item) => item.taskId), ["a", "c", "b"]);
});
