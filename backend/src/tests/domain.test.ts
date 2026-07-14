import assert from "node:assert/strict";
import test from "node:test";
import { autoMatchTasksToVideos } from "../domain/matching.js";
import { normalizeTaskStatus, normalizeVideoStatus } from "../domain/status.js";
import { getPreviousDateKey, getShanghaiDateKey } from "../domain/dailyEstimate.js";

test("daily estimate dates use the Shanghai calendar across UTC midnight", () => {
  const now = new Date("2026-07-11T16:30:00.000Z");
  assert.equal(getShanghaiDateKey(now), "2026-07-12");
  assert.equal(getPreviousDateKey(now), "2026-07-11");
});

test("normalizeVideoStatus maps known Chinese states", () => {
  assert.equal(normalizeVideoStatus("审核中"), "reviewing");
  assert.equal(normalizeVideoStatus("已删除"), "deleted");
  assert.equal(normalizeVideoStatus("仅自己可见"), "private");
  assert.equal(normalizeVideoStatus("未知"), "unknown");
});

test("normalizeTaskStatus maps known Chinese task states", () => {
  assert.equal(normalizeTaskStatus("审核通过"), "in_progress");
  assert.equal(normalizeTaskStatus("待结算"), "settling");
  assert.equal(normalizeTaskStatus("已发放"), "completed");
  assert.equal(normalizeTaskStatus("异常"), "abnormal");
});

test("autoMatchTasksToVideos prefers title and published time proximity", () => {
  const matches = autoMatchTasksToVideos(
    [
      {
        id: "task_1",
        missionId: "mission_1",
        accountId: "acct_1",
        taskName: "#南部档案",
        videoTitle: "#南部档案",
        coverUrl: null,
        publishedAt: "2026-07-05T10:00:00+08:00",
        xingtuPlayCount: 100,
        predictedAmount: null,
        missionEstimatedAmount: null,
        settledAmount: null,
        taskStatus: "in_progress",
        sourceUrl: null
      }
    ],
    [
      {
        id: "video_1",
        accountId: "acct_1",
        title: "南部档案",
        coverUrl: null,
        publishedAt: "2026-07-05T11:00:00+08:00",
        actualPlayCount: 120,
        videoStatus: "published",
        sourceUrl: null
      }
    ]
  );

  assert.deepEqual(matches, [{ taskId: "task_1", videoId: "video_1", matchSource: "auto" }]);
});
