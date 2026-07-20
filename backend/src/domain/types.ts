export type VideoStatus = "published" | "reviewing" | "rejected" | "private" | "deleted" | "unknown";
export type TaskStatus = "in_progress" | "settling" | "completed" | "paused" | "abnormal" | "unknown";
export type MatchSource = "auto" | "manual";

export type AccountRecord = {
  id: string;
  displayName: string;
  douyinId: string | null;
  platform: string;
  sessionDir: string;
  loginStatus: string;
  lastSyncAt: string | null;
  lastError: string | null;
};

export type VideoRecord = {
  id: string;
  accountId: string;
  title: string;
  coverUrl: string | null;
  publishedAt: string | null;
  actualPlayCount: number | null;
  videoStatus: VideoStatus;
  sourceUrl: string | null;
};

export type XingtuTaskRecord = {
  id: string;
  missionId: string;
  accountId: string;
  taskName: string;
  videoTitle: string | null;
  coverUrl: string | null;
  publishedAt: string | null;
  xingtuPlayCount: number | null;
  predictedAmount: number | null;
  missionEstimatedAmount: number | null;
  settledAmount: number | null;
  taskStatus: TaskStatus;
  sourceUrl: string | null;
};

export type TaskVideoRow = {
  taskId: string;
  missionId: string;
  videoId: string | null;
  accountId: string;
  accountName: string;
  taskName: string;
  videoTitle: string | null;
  publishedAt: string | null;
  xingtuPlayCount: number | null;
  actualPlayCount: number | null;
  playDelta: number | null;
  predictedAmount: number | null;
  missionEstimatedAmount: number | null;
  yesterdayPredictedAmount: number | null;
  yesterdayTaskPredictedAmount: number | null;
  hasYesterdayTaskBaseline: number;
  todayPredictedDelta: number | null;
  settledAmount: number | null;
  videoStatus: VideoStatus | null;
  taskStatus: TaskStatus;
  lastSyncedAt: string | null;
  matchSource: MatchSource | null;
};
