import { getPreviousDateKey, getShanghaiDateKey } from "../domain/dailyEstimate.js";
import type { AccountRecord } from "../domain/types.js";
import type { DailyPlayGrowthSummary } from "../domain/types.js";
import { AppDatabase, type DailyEstimateTrendPoint } from "./db.js";

export type DashboardAccountState = {
  accountId: string;
  displayName: string;
  archived: boolean;
  loginStatus: string;
  lastSyncAt: string | null;
  freshness: "fresh" | "stale" | "missing" | "archived";
  snapshotStatus: "fresh" | "carried_forward" | "missing";
  message: string | null;
};

export type DashboardSummary = {
  updatedAt: string | null;
  realtimeEstimatedTotal: number | null;
  yesterdayFinalEstimatedTotal: number | null;
  dailyIncrease: number | null;
  dailyPlayGrowth: number | null;
  dailyPlayGrowthCoverage: DailyPlayGrowthSummary["dailyPlayGrowthCoverage"];
  snapshotDate: string;
  snapshot: {
    expectedAccountCount: number;
    freshAccountCount: number;
    carriedForwardAccountCount: number;
    missingAccountCount: number;
    isComplete: boolean;
    missingAccounts: DashboardAccountState[];
  };
  accounts: {
    activeCount: number;
    exceptionCount: number;
    pendingSyncCount: number;
    exceptions: DashboardAccountState[];
  };
};

export type DashboardTrend = {
  from: string;
  to: string;
  points: DailyEstimateTrendPoint[];
};

function isEligibleForSnapshot(account: AccountRecord, snapshotDate: string): boolean {
  return Boolean(account.firstLoggedInAt && getShanghaiDateKey(new Date(account.firstLoggedInAt)) <= snapshotDate);
}

function isShanghaiDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T12:00:00+08:00`);
  return !Number.isNaN(date.getTime()) && getShanghaiDateKey(date) === value;
}

function getFreshness(account: AccountRecord, snapshotDate: string, now: Date, db: AppDatabase): DashboardAccountState {
  const archived = account.archivedAt !== null;
  const current = db.getDailySnapshot(account.id, snapshotDate);
  const fallback = current?.status === "fresh" || current?.status === "carried_forward"
    ? current
    : db.getLatestUsableDailySnapshot(account.id, snapshotDate);
  const snapshotStatus = current?.status === "fresh"
    ? "fresh"
    : fallback
      ? "carried_forward"
      : "missing";
  const elapsed = account.lastSyncAt ? now.getTime() - new Date(account.lastSyncAt).getTime() : Number.POSITIVE_INFINITY;
  const freshness = archived
    ? "archived"
    : snapshotStatus === "missing"
      ? "missing"
      : elapsed > 2 * 60 * 60 * 1000
        ? "stale"
        : "fresh";

  return {
    accountId: account.id,
    displayName: account.displayName,
    archived,
    loginStatus: account.loginStatus,
    lastSyncAt: account.lastSyncAt,
    freshness,
    snapshotStatus,
    message: snapshotStatus === "missing"
      ? account.lastError ?? "没有可用的日快照。"
      : account.lastError
  };
}

export class StatisticsService {
  constructor(private readonly db: AppDatabase) {}

  getDashboardTrend(options: { days?: number; from?: string; to?: string } = {}, now = new Date()): DashboardTrend {
    const yesterday = getPreviousDateKey(now);
    const customRange = options.from !== undefined || options.to !== undefined;
    let from: string;
    let to: string;

    if (customRange) {
      if (!options.from || !options.to || !isShanghaiDateKey(options.from) || !isShanghaiDateKey(options.to) || options.from > options.to) {
        throw new Error("趋势日期范围无效");
      }
      from = options.from;
      to = options.to;
    } else {
      const days = options.days ?? 7;
      if (!Number.isInteger(days) || days < 1 || days > 90) {
        throw new Error("趋势天数必须在 1 到 90 之间");
      }
      to = yesterday;
      const start = new Date(`${to}T12:00:00+08:00`);
      start.setUTCDate(start.getUTCDate() - days + 1);
      from = getShanghaiDateKey(start);
    }

    return { from, to, points: this.db.getDailyEstimateTrend(from, to) };
  }

  getDashboardSummary(now = new Date()): DashboardSummary {
    const estimate = this.db.getDailyEstimateSummary(now);
    const playGrowth = this.db.getDailyPlayGrowthSummary(now);
    const snapshotDate = getPreviousDateKey(now);
    const accounts = this.db.listAccounts({ includeArchived: true });
    const accountsById = new Map(accounts.map((account) => [account.id, account]));
    const states = accounts.map((account) => getFreshness(account, snapshotDate, now, this.db));
    const missingAccounts = states.filter((account) => {
      const record = accountsById.get(account.accountId)!;
      return isEligibleForSnapshot(record, snapshotDate) && account.snapshotStatus === "missing";
    });
    const activeStates = states.filter((account) => !account.archived);
    const exceptions = activeStates.filter((account) => account.loginStatus !== "active" || account.message !== null);
    const pendingSyncCount = activeStates.filter((account) => account.freshness === "stale" || account.freshness === "missing").length;
    const updatedAt = activeStates.reduce<string | null>((latest, account) => {
      if (!account.lastSyncAt || (latest && latest >= account.lastSyncAt)) {
        return latest;
      }
      return account.lastSyncAt;
    }, null);

    return {
      updatedAt,
      realtimeEstimatedTotal: estimate.todayEstimatedTotal,
      yesterdayFinalEstimatedTotal: estimate.yesterdayEstimatedTotal,
      dailyIncrease: estimate.dailyIncrease,
      dailyPlayGrowth: playGrowth.dailyPlayGrowth,
      dailyPlayGrowthCoverage: playGrowth.dailyPlayGrowthCoverage,
      snapshotDate,
      snapshot: {
        expectedAccountCount: estimate.expectedAccountCount,
        freshAccountCount: estimate.freshAccountCount,
        carriedForwardAccountCount: estimate.carriedForwardAccountCount,
        missingAccountCount: missingAccounts.length,
        isComplete: missingAccounts.length === 0,
        missingAccounts
      },
      accounts: {
        activeCount: activeStates.filter((account) => account.loginStatus === "active").length,
        exceptionCount: exceptions.length,
        pendingSyncCount,
        exceptions
      }
    };
  }
}
