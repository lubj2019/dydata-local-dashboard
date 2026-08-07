import { getPreviousDateKey, getShanghaiDateKey } from "../domain/dailyEstimate.js";
import type { AccountRecord } from "../domain/types.js";
import { AppDatabase } from "./db.js";

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

function isEligibleForSnapshot(account: AccountRecord, snapshotDate: string): boolean {
  return Boolean(account.firstLoggedInAt && getShanghaiDateKey(new Date(account.firstLoggedInAt)) <= snapshotDate);
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

  getDashboardSummary(now = new Date()): DashboardSummary {
    const estimate = this.db.getDailyEstimateSummary(now);
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
