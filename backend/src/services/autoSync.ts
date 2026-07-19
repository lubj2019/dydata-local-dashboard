import type { AccountRecord } from "../domain/types.js";
import { AppDatabase } from "./db.js";
import { ScraperService } from "./scraper.js";

const STARTUP_SYNC_DELAY_MS = 15_000;
const REGULAR_SYNC_INTERVAL_MS = 30 * 60 * 1000;
const DAILY_PRIMARY_HOUR = 23;
const DAILY_PRIMARY_MINUTE = 30;
const DAILY_RETRY_HOUR = 23;
const DAILY_RETRY_MINUTE = 50;
const ACCOUNT_SYNC_CONCURRENCY = 3;

type LoggerLike = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

export type AutoSyncReason = "startup" | "interval" | "daily_primary" | "daily_retry" | "manual_full";

export type AutoSyncStatus = {
  enabled: boolean;
  isRunning: boolean;
  currentReason: AutoSyncReason | null;
  queuedReason: AutoSyncReason | null;
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

export function isAutoSyncEligibleAccount(account: Pick<AccountRecord, "loginStatus">): boolean {
  return account.loginStatus === "active" || account.loginStatus === "session_recheck_pending";
}

export function computeNextDailyRunAt(now: Date, hour: number, minute: number): Date {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}

export function computeNextDailyCutoff(now: Date): Date {
  return computeNextDailyRunAt(now, DAILY_PRIMARY_HOUR, DAILY_PRIMARY_MINUTE);
}

export function computeNextDailyRetry(now: Date): Date {
  return computeNextDailyRunAt(now, DAILY_RETRY_HOUR, DAILY_RETRY_MINUTE);
}

function computeNextRegularRun(now: Date): Date {
  return new Date(now.getTime() + REGULAR_SYNC_INTERVAL_MS);
}

function pickQueuedReason(current: AutoSyncReason | null, next: AutoSyncReason): AutoSyncReason {
  const priority: Record<AutoSyncReason, number> = {
    startup: 1,
    interval: 2,
    manual_full: 3,
    daily_primary: 4,
    daily_retry: 5
  };

  if (!current) {
    return next;
  }

  return priority[next] >= priority[current] ? next : current;
}

function formatRunReason(reason: AutoSyncReason): string {
  switch (reason) {
    case "startup":
      return "startup";
    case "interval":
      return "interval";
    case "daily_primary":
      return "daily_primary";
    case "daily_retry":
      return "daily_retry";
    case "manual_full":
      return "manual_full";
  }
}

function sortAccountsForSync(accounts: AccountRecord[]): AccountRecord[] {
  return [...accounts].sort((left, right) => {
    const leftTime = left.lastSyncAt ? Date.parse(left.lastSyncAt) : 0;
    const rightTime = right.lastSyncAt ? Date.parse(right.lastSyncAt) : 0;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return left.displayName.localeCompare(right.displayName, "zh-CN");
  });
}

function formatAutoSyncErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "自动同步失败";

  if (message.includes("browserType.launchPersistentContext")) {
    return "浏览器启动失败，可能是该账号会话目录被占用，或 Chrome 进程异常退出，请稍后重试。";
  }

  if (message.includes("Target page, context or browser has been closed")) {
    return "浏览器启动失败，请关闭残留的浏览器窗口后重试。";
  }

  return message.split("\n")[0] ?? message;
}

export class AutoSyncService {
  private readonly status: AutoSyncStatus = {
    enabled: true,
    isRunning: false,
    currentReason: null,
    queuedReason: null,
    currentAccountId: null,
    currentAccountName: null,
    activeAccounts: [],
    parallelLimit: ACCOUNT_SYNC_CONCURRENCY,
    accountsTotal: 0,
    accountsCompleted: 0,
    accountsFailed: 0,
    accountsSkipped: 0,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastSuccessAt: null,
    lastError: null,
    nextRegularRunAt: null,
    nextDailyCutoffAt: null,
    nextDailyRetryAt: null,
    nextPlannedRunAt: null
  };

  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private regularTimer: ReturnType<typeof setTimeout> | null = null;
  private dailyPrimaryTimer: ReturnType<typeof setTimeout> | null = null;
  private dailyRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private activeRun: Promise<void> | null = null;
  private started = false;
  private startupRunAt: string | null = null;

  constructor(
    private readonly db: AppDatabase,
    private readonly scraper: ScraperService,
    private readonly logger: LoggerLike
  ) {}

  start() {
    if (this.started) {
      return;
    }

    this.started = true;
    this.scheduleStartupRun();
    this.scheduleRegularRun();
    this.scheduleDailyPrimaryRun();
    this.scheduleDailyRetryRun();
  }

  stop() {
    this.started = false;
    this.startupRunAt = null;

    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.regularTimer) {
      clearTimeout(this.regularTimer);
      this.regularTimer = null;
    }
    if (this.dailyPrimaryTimer) {
      clearTimeout(this.dailyPrimaryTimer);
      this.dailyPrimaryTimer = null;
    }
    if (this.dailyRetryTimer) {
      clearTimeout(this.dailyRetryTimer);
      this.dailyRetryTimer = null;
    }
  }

  getStatus(): AutoSyncStatus {
    return {
      ...this.status,
      activeAccounts: [...this.status.activeAccounts]
    };
  }

  requestManualFullSync(): { status: "started" | "queued" } {
    if (this.activeRun) {
      this.status.queuedReason = pickQueuedReason(this.status.queuedReason, "manual_full");
      this.status.nextPlannedRunAt = new Date().toISOString();
      return { status: "queued" };
    }

    void this.run("manual_full");
    return { status: "started" };
  }

  private scheduleStartupRun() {
    const next = new Date(Date.now() + STARTUP_SYNC_DELAY_MS);
    this.startupRunAt = next.toISOString();
    this.refreshNextPlannedRunAt();
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      this.startupRunAt = null;
      void this.run("startup");
    }, STARTUP_SYNC_DELAY_MS);
  }

  private scheduleRegularRun() {
    const next = computeNextRegularRun(new Date());
    this.status.nextRegularRunAt = next.toISOString();
    this.refreshNextPlannedRunAt();

    this.regularTimer = setTimeout(() => {
      this.regularTimer = null;
      if (this.started) {
        this.scheduleRegularRun();
      }
      void this.run("interval");
    }, Math.max(1_000, next.getTime() - Date.now()));
  }

  private scheduleDailyPrimaryRun() {
    const next = computeNextDailyCutoff(new Date());
    this.status.nextDailyCutoffAt = next.toISOString();
    this.refreshNextPlannedRunAt();

    this.dailyPrimaryTimer = setTimeout(() => {
      this.dailyPrimaryTimer = null;
      if (this.started) {
        this.scheduleDailyPrimaryRun();
      }
      void this.run("daily_primary");
    }, Math.max(1_000, next.getTime() - Date.now()));
  }

  private scheduleDailyRetryRun() {
    const next = computeNextDailyRetry(new Date());
    this.status.nextDailyRetryAt = next.toISOString();
    this.refreshNextPlannedRunAt();

    this.dailyRetryTimer = setTimeout(() => {
      this.dailyRetryTimer = null;
      if (this.started) {
        this.scheduleDailyRetryRun();
      }
      void this.run("daily_retry");
    }, Math.max(1_000, next.getTime() - Date.now()));
  }

  private refreshNextPlannedRunAt() {
    const timestamps = [
      this.status.nextRegularRunAt,
      this.status.nextDailyCutoffAt,
      this.status.nextDailyRetryAt
    ].filter((value): value is string => Boolean(value));

    if (this.startupRunAt) {
      timestamps.push(this.startupRunAt);
    }

    if (timestamps.length === 0) {
      this.status.nextPlannedRunAt = null;
      return;
    }

    timestamps.sort((left, right) => Date.parse(left) - Date.parse(right));
    this.status.nextPlannedRunAt = timestamps[0] ?? null;
  }

  private syncCurrentAccount() {
    this.status.currentAccountName = this.status.activeAccounts[0] ?? null;
    this.status.currentAccountId = null;
  }

  private addActiveAccount(account: AccountRecord) {
    this.status.activeAccounts = [...this.status.activeAccounts, account.displayName];
    this.syncCurrentAccount();
  }

  private removeActiveAccount(account: AccountRecord) {
    this.status.activeAccounts = this.status.activeAccounts.filter((name) => name !== account.displayName);
    this.syncCurrentAccount();
  }

  private async run(reason: AutoSyncReason) {
    if (this.activeRun) {
      this.status.queuedReason = pickQueuedReason(this.status.queuedReason, reason);
      return this.activeRun;
    }

    const startedAt = new Date().toISOString();
    const allAccounts = this.db.listAccounts();
    const eligibleAccounts = sortAccountsForSync(allAccounts.filter(isAutoSyncEligibleAccount));
    let failedAccounts = 0;
    let succeededAccounts = 0;
    let nextIndex = 0;

    if (reason === "startup") {
      this.startupRunAt = null;
    }

    this.status.isRunning = true;
    this.status.currentReason = reason;
    this.status.currentAccountId = null;
    this.status.currentAccountName = null;
    this.status.activeAccounts = [];
    this.status.accountsTotal = eligibleAccounts.length;
    this.status.accountsCompleted = 0;
    this.status.accountsFailed = 0;
    this.status.accountsSkipped = allAccounts.length - eligibleAccounts.length;
    this.status.lastStartedAt = startedAt;
    this.status.lastError = null;
    this.status.queuedReason = null;
    this.refreshNextPlannedRunAt();

    const workerCount = Math.min(ACCOUNT_SYNC_CONCURRENCY, Math.max(eligibleAccounts.length, 1));

    const job = (async () => {
      this.logger.info(
        `[auto-sync] started ${formatRunReason(reason)} with ${eligibleAccounts.length} eligible account(s), concurrency=${workerCount}`
      );

      const workers = Array.from({ length: workerCount }, async () => {
        while (true) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          if (currentIndex >= eligibleAccounts.length) {
            return;
          }

          const account = eligibleAccounts[currentIndex];
          if (!account) {
            return;
          }
          this.addActiveAccount(account);

          try {
            await this.scraper.syncAccount(account.id);
            succeededAccounts += 1;
          } catch (error) {
            failedAccounts += 1;
            const message = formatAutoSyncErrorMessage(error);
            this.status.lastError = `${account.displayName}: ${message}`;
            this.logger.warn(`[auto-sync] skipped failed account ${account.displayName}: ${message}`);
          } finally {
            this.removeActiveAccount(account);
            this.status.accountsCompleted += 1;
            this.status.accountsFailed = failedAccounts;
          }
        }
      });

      await Promise.all(workers);

      const finishedAt = new Date().toISOString();
      this.status.lastFinishedAt = finishedAt;
      this.status.currentAccountId = null;
      this.status.currentAccountName = null;
      this.status.currentReason = null;
      this.status.activeAccounts = [];
      this.status.isRunning = false;

      if (failedAccounts === 0) {
        this.status.lastError = null;
      }
      if (succeededAccounts > 0) {
        this.status.lastSuccessAt = finishedAt;
      }

      this.logger.info(
        `[auto-sync] finished ${formatRunReason(reason)}: success=${succeededAccounts}, failed=${failedAccounts}`
      );
    })()
      .catch((error) => {
        const message = formatAutoSyncErrorMessage(error);
        this.status.lastError = message;
        this.status.lastFinishedAt = new Date().toISOString();
        this.status.currentAccountId = null;
        this.status.currentAccountName = null;
        this.status.currentReason = null;
        this.status.activeAccounts = [];
        this.status.isRunning = false;
        this.logger.error(`[auto-sync] fatal error: ${message}`);
      })
      .finally(() => {
        this.activeRun = null;
        const queuedReason = this.status.queuedReason;
        this.status.queuedReason = null;
        this.refreshNextPlannedRunAt();

        if (queuedReason && this.started) {
          void this.run(queuedReason);
        }
      });

    this.activeRun = job;
    return job;
  }
}
