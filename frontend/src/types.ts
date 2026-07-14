export type AccountSummary = {
  id: string;
  displayName: string;
  platform: string;
  loginStatus: string;
  lastSyncAt: string | null;
  lastError: string | null;
};

export type AutoSyncStatus = {
  enabled: boolean;
  isRunning: boolean;
  currentReason: string | null;
  queuedReason: string | null;
  currentAccountId: string | null;
  currentAccountName: string | null;
  activeAccounts: string[];
  parallelLimit: number;
  accountsTotal: number;
  accountsCompleted: number;
  accountsFailed: number;
  accountsSkipped: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextRegularRunAt: string | null;
  nextDailyCutoffAt: string | null;
  nextDailyRetryAt: string | null;
  nextPlannedRunAt: string | null;
};

export type DailyEstimateSummary = {
  yesterdayEstimatedTotal: number | null;
  todayEstimatedTotal: number;
  dailyIncrease: number | null;
};

export type MatchSource = "auto" | "manual" | null;

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
  videoStatus: string | null;
  taskStatus: string;
  lastSyncedAt: string | null;
  matchSource: MatchSource;
};
