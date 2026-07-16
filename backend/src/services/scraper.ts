import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { normalizeTaskStatus, normalizeVideoStatus } from "../domain/status.js";
import type {
  AccountRecord,
  TaskStatus,
  VideoRecord,
  VideoStatus,
  XingtuTaskRecord
} from "../domain/types.js";
import { AppDatabase } from "./db.js";

const CREATOR_LOGIN_URL = "https://creator.douyin.com/creator-micro/revenue/tasks";
const TASK_LIST_API = "https://creator.douyin.com/aweme/v1/creator/mission/mine/card/list/";
const TASK_DETAIL_API =
  "https://creator.douyin.com/web/api/third_party/star/gw/api/challenge/author_get_challenge_order_list";
const TASK_SUMMARY_API = "https://creator.douyin.com/web/api/third_party/star/gw/api/challenge/author_get_challenge";
const WORK_LIST_API = "https://creator.douyin.com/janus/douyin/creator/pc/work_list";
const SESSION_LOCK_FILENAMES = ["SingletonCookie", "SingletonLock", "SingletonSocket", "lockfile", "DevToolsActivePort"];
const TASK_DETAIL_CONCURRENCY = 3;
const PLATFORM_REQUEST_CONCURRENCY = 3;
const FETCH_RETRY_ATTEMPTS = 3;
const FETCH_RETRY_BASE_DELAY_MS = 300;

const CHROME_CANDIDATE_PATHS = [
  process.env.CHROME_EXECUTABLE_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  path.join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe")
].filter((value): value is string => Boolean(value));

type LoginState = {
  loggedIn: boolean;
  message: string;
};

type MissionCard = {
  id_str?: string;
  name?: string;
  card_status?: string | number;
};

type MissionListPayload = {
  has_more?: boolean;
  next_cursor?: number | string;
  mission_cards?: MissionCard[];
  status_code?: number;
  status_message?: string;
  base_resp?: {
    status_code?: number;
    status_message?: string;
  };
};

type ChallengeOrder = {
  title?: string;
  item_id?: string | number;
  video_id?: string;
  url?: string;
  create_time?: number | string;
  challenge_item_status?: number | string;
  play?: number | string;
  reward_amount?: number | string | null;
  est_reward_amount?: number | string | null;
  author_total_share?: number | string | null;
  audit_info?: {
    audit_result_by_source?: Record<
      string,
      {
        audit_status?: number;
        audit_ban_reason?: string;
      }
    >;
  };
  data?: {
    offline_natural_effect_data?: {
      watch_cnt?: number | string;
    };
  };
};

type ChallengeOrderPayload = {
  orders?: Array<{
    item?: ChallengeOrder;
  }>;
  base_resp?: {
    status_code?: number;
    status_message?: string;
  };
};

type ChallengeSummaryPayload = {
  progress?: {
    reward_amount?: number | string | null;
    bill_detail?: Record<string, number | string | null>;
  };
  base_resp?: {
    status_code?: number;
    status_message?: string;
  };
};

type WorkItem = {
  aweme_id?: string | number;
  item_id?: string | number;
  caption?: string;
  desc?: string;
  create_time?: number | string;
  share_url?: string;
  author?: {
    nickname?: string;
  };
  statistics?: {
    play_count?: number | string;
  };
  status?: {
    in_reviewing?: boolean;
    is_delete?: boolean;
    is_private?: boolean;
    is_prohibited?: boolean;
    private_status?: number | string;
    self_see?: boolean;
  };
};

type WorkListPayload = {
  aweme_list?: WorkItem[];
  has_more?: boolean;
  max_cursor?: number | string;
  status_code?: number;
  status_msg?: string;
};

type WorkVideoCandidate = {
  record: VideoRecord;
  awemeId: string | null;
  itemId: string | null;
  normalizedTitle: string | null;
  publishedAtMs: number | null;
};

type AccountIdentity = {
  displayName: string | null;
};

type LoggerLike = {
  info(message: string): void;
};

type ScrapeMetrics = {
  requestCount: number;
  retryCount: number;
  workVideosMs: number;
  taskCardsMs: number;
  taskDetailsMs: number;
};

export class SessionExpiredError extends Error {}

export class FetchRequestError extends Error {
  constructor(readonly status: number, url: string) {
    super(`Request failed (${status}): ${url}`);
  }
}

export class PlatformTemporaryError extends Error {}

export class RequestLimiter {
  private activeCount = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }

    this.activeCount += 1;
    try {
      return await operation();
    } finally {
      this.activeCount -= 1;
      this.waiters.shift()?.();
    }
  }
}

export function isRetryableFetchError(error: unknown): boolean {
  if (error instanceof FetchRequestError) {
    return error.status === 429 || (error.status >= 500 && error.status < 600);
  }

  if (error instanceof PlatformTemporaryError) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("net::err_") ||
    message.includes("econnreset") ||
    message.includes("socket hang up") ||
    message.includes("network error")
  );
}

export async function retryFetch<T>(
  operation: () => Promise<T>,
  options: {
    attempts?: number;
    wait?: (delayMs: number) => Promise<void>;
    onRetry?: () => void;
  } = {}
): Promise<T> {
  const attempts = options.attempts ?? FETCH_RETRY_ATTEMPTS;
  const wait = options.wait ?? ((delayMs) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt + 1 >= attempts || !isRetryableFetchError(error)) {
        throw error;
      }

      options.onRetry?.();
      await wait(FETCH_RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }

  throw new Error("Fetch retry attempts were exhausted");
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let failed = false;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (!failed) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }

      try {
        results[currentIndex] = await worker(items[currentIndex]!);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  });

  await Promise.all(workers);
  return results;
}

function resolveChromeExecutablePath(): string | undefined {
  return CHROME_CANDIDATE_PATHS.find((candidate) => fs.existsSync(candidate));
}

function isRecoverableLaunchError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("ProcessSingleton") ||
    error.message.includes("profile is already in use") ||
    error.message.includes("Target page, context or browser has been closed") ||
    error.message.includes("browserType.launchPersistentContext")
  );
}

function cleanupSessionArtifacts(sessionDir: string) {
  for (const fileName of SESSION_LOCK_FILENAMES) {
    try {
      fs.rmSync(path.join(sessionDir, fileName), { force: true });
    } catch {
      // Ignore stale lock cleanup failures and continue with other files.
    }
  }
}

function terminateSessionBrowserProcesses(sessionDir: string) {
  if (process.platform !== "win32") {
    return;
  }

  const escapedPath = sessionDir.replace(/'/g, "''");
  const script = `
$targets = Get-CimInstance Win32_Process |
  Where-Object {
    ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe' -or $_.Name -eq 'chromium.exe') -and
    $_.CommandLine -like '*${escapedPath}*'
  } |
  Select-Object -ExpandProperty ProcessId
foreach ($target in $targets) {
  taskkill /PID $target /T /F | Out-Null
}
`;

  try {
    execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
      stdio: "ignore",
      windowsHide: true
    });
  } catch {
    // Ignore process cleanup failures and continue with launch retry.
  }
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseChineseNumber(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/,/g, "").trim();
  const match = cleaned.match(/([0-9]+(?:\.[0-9]+)?)(万|亿)?/);
  if (!match) {
    return null;
  }

  const base = Number(match[1]);
  if (!Number.isFinite(base)) {
    return null;
  }

  if (match[2] === "万") {
    return Math.round(base * 10000);
  }
  if (match[2] === "亿") {
    return Math.round(base * 100000000);
  }

  return Math.round(base);
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    return parseChineseNumber(value);
  }
  return null;
}

function parseAmount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[¥￥,\s]/g, "");
    if (!cleaned) {
      return null;
    }

    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseTaskMoney(value: unknown): number | null {
  const amount = parseAmount(value);
  if (amount === null) {
    return null;
  }

  return amount / 1000;
}

export function parseMissionEstimatedAmount(payload: ChallengeSummaryPayload): number | null {
  return parseTaskMoney(payload.progress?.reward_amount ?? payload.progress?.bill_detail?.["3000"]);
}

function normalizeComparableTitle(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, "").trim();
  return normalized ? normalized : null;
}

function parseAwemeIdFromUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/\/share\/video\/(\d+)/);
  return match?.[1] ?? null;
}

function buildScopedVideoId(accountId: string, videoId: string): string {
  return `${accountId}:${videoId}`;
}

export function buildScopedTaskId(accountId: string, missionId: string, videoId: string): string {
  return `${accountId}:${missionId}:${videoId}`;
}

function toEpochMillis(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 1e12 ? numeric : numeric * 1000;
  }

  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

function toIsoString(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const millis = toEpochMillis(value);
  return millis === null ? null : new Date(millis).toISOString();
}

function toUserErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "操作失败";
  if (message.includes("Target page, context or browser has been closed")) {
    return "浏览器启动失败，请关闭已占用的登录窗口后重试";
  }

  return message.split("\n")[0] ?? message;
}

function readAuditResult(order: ChallengeOrder): { taskText: string | null; videoStatus: VideoStatus } {
  const source = order.audit_info?.audit_result_by_source;
  if (!source || typeof source !== "object") {
    return { taskText: null, videoStatus: "unknown" };
  }

  for (const value of Object.values(source)) {
    if (!value || typeof value !== "object") {
      continue;
    }

    if (value.audit_status === 1) {
      return {
        taskText: "审核通过",
        videoStatus: "published"
      };
    }

    if (value.audit_status === 0) {
      return {
        taskText: value.audit_ban_reason || "审核失败",
        videoStatus: normalizeVideoStatus(value.audit_ban_reason || "审核失败")
      };
    }
  }

  return { taskText: null, videoStatus: "unknown" };
}

function mapMissionStatus(cardStatus: MissionCard["card_status"]): TaskStatus {
  if (typeof cardStatus === "number") {
    if (cardStatus === 1) {
      return "in_progress";
    }
    if (cardStatus === 2) {
      return "completed";
    }
    if (cardStatus === 3) {
      return "paused";
    }
  }

  if (typeof cardStatus === "string") {
    return normalizeTaskStatus(cardStatus);
  }

  return "unknown";
}

function mapWorkVideoStatus(work: WorkItem): VideoStatus {
  const status = work.status;
  if (!status) {
    return "unknown";
  }

  if (status.is_delete) {
    return "deleted";
  }

  if (status.is_private || status.self_see || Number(status.private_status ?? 0) !== 0) {
    return "private";
  }

  if (status.in_reviewing) {
    return "reviewing";
  }

  if (status.is_prohibited) {
    return "rejected";
  }

  return "published";
}

function findPlatformTemporaryError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as {
    status_message?: unknown;
    status_msg?: unknown;
    base_resp?: { status_message?: unknown };
  };
  const message = [record.status_message, record.status_msg, record.base_resp?.status_message].find(
    (value): value is string => typeof value === "string" && value.toLowerCase().includes("internal system error")
  );

  return message ?? null;
}

export function findPlatformLoginError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as {
    status_message?: unknown;
    status_msg?: unknown;
    message?: unknown;
    base_resp?: { status_message?: unknown };
  };
  const message = [record.status_message, record.status_msg, record.message, record.base_resp?.status_message].find(
    (value): value is string =>
      typeof value === "string" &&
      (/\u7528\u6237\u672a\u767b\u5f55|\u767b\u5f55\u5931\u6548|\u767b\u5f55\u8fc7\u671f/i.test(value) || /not\s+logged\s+in|login\s+(?:has\s+)?expired/i.test(value))
  );

  return message ?? null;
}

async function fetchLooseJsonOnce(page: Page, url: string): Promise<unknown> {
  const payload = await page.evaluate(async (targetUrl) => {
    const response = await fetch(targetUrl, {
      credentials: "include"
    });

    return {
      ok: response.ok,
      status: response.status,
      text: await response.text()
    };
  }, url);

  if (!payload.ok) {
    throw new FetchRequestError(payload.status, url);
  }

  const parsed = JSON.parse(payload.text);
  const loginError = findPlatformLoginError(parsed);
  if (loginError) {
    throw new SessionExpiredError(loginError);
  }
  const temporaryError = findPlatformTemporaryError(parsed);
  if (temporaryError) {
    throw new PlatformTemporaryError(temporaryError);
  }

  return parsed;
}

async function fetchLooseJson(
  page: Page,
  url: string,
  metrics?: Pick<ScrapeMetrics, "requestCount" | "retryCount">,
  limiter?: RequestLimiter
): Promise<unknown> {
  return retryFetch(
    async () => {
      const request = async () => {
        if (metrics) {
          metrics.requestCount += 1;
        }
        return fetchLooseJsonOnce(page, url);
      };

      return limiter ? limiter.run(request) : request();
    },
    {
      onRetry: () => {
        if (metrics) {
          metrics.retryCount += 1;
        }
      }
    }
  );
}

async function probeCreatorLogin(page: Page, limiter?: RequestLimiter): Promise<LoginState> {
  try {
    const probeUrl = new URL(TASK_LIST_API);
    probeUrl.searchParams.set("cursor", "0");
    probeUrl.searchParams.set("limit", "1");
    probeUrl.searchParams.set("mission_type", "1");

    const payload = (await fetchLooseJson(page, probeUrl.toString(), undefined, limiter)) as MissionListPayload;
    const apiStatus = payload.base_resp?.status_code ?? payload.status_code;
    const apiMessage = payload.base_resp?.status_message ?? payload.status_message;

    if (apiStatus === 8 || apiStatus === 11001) {
      return {
        loggedIn: false,
        message: apiMessage ?? "创作者中心未登录，请扫码登录"
      };
    }

    const xingtuProbeUrl = new URL(TASK_SUMMARY_API);
    xingtuProbeUrl.searchParams.set("challenge_id", "0");
    await fetchLooseJson(page, xingtuProbeUrl.toString(), undefined, limiter);

    return {
      loggedIn: true,
      message: "创作者中心和星图任务接口均已登录"
    };
  } catch (error) {
    return {
      loggedIn: false,
      message: toUserErrorMessage(error)
    };
  }
}

async function ensureLoggedIn(page: Page, limiter?: RequestLimiter) {
  const state = await probeCreatorLogin(page, limiter);
  if (!state.loggedIn) {
    throw new SessionExpiredError(state.message);
  }
}

export class ScraperService {
  private readonly loginJobs = new Map<string, Promise<void>>();
  private readonly syncJobs = new Map<string, Promise<void>>();
  private readonly requestLimiter = new RequestLimiter(PLATFORM_REQUEST_CONCURRENCY);
  private readonly chromeExecutablePath = resolveChromeExecutablePath();

  constructor(
    private readonly db: AppDatabase,
    private readonly logger: LoggerLike = console
  ) {}

  async launchLogin(accountId: string) {
    const account = this.requireAccount(accountId);
    if (this.loginJobs.has(accountId)) {
      return;
    }

    this.db.updateAccountStatus(accountId, {
      loginStatus: "waiting_scan",
      lastError: null
    });

    const job = this.runLoginFlow(account)
      .catch((error) => {
        this.db.updateAccountStatus(account.id, {
          loginStatus: "error",
          lastError: toUserErrorMessage(error)
        });
      })
      .finally(() => {
        this.loginJobs.delete(accountId);
      });

    this.loginJobs.set(accountId, job);
  }

  async syncAccount(accountId: string) {
    const existingJob = this.syncJobs.get(accountId);
    if (existingJob) {
      await existingJob;
      return;
    }

    const job = this.runSyncAccount(accountId).finally(() => {
      this.syncJobs.delete(accountId);
    });

    this.syncJobs.set(accountId, job);
    await job;
  }

  private requireAccount(accountId: string): AccountRecord {
    const account = this.db.getAccount(accountId);
    if (!account) {
      throw new Error("账号不存在");
    }
    return account;
  }

  private async runSyncAccount(accountId: string) {
    const account = this.requireAccount(accountId);
    const startedAt = Date.now();
    try {
      const payload = await this.scrapeCreatorData(account);
      if (payload.accountIdentity.displayName) {
        this.db.updateAccountDisplayName(accountId, payload.accountIdentity.displayName);
      }
      this.db.replaceAccountSyncData(accountId, payload);
      this.db.updateAccountStatus(accountId, {
        loginStatus: "active",
        lastSyncAt: new Date().toISOString(),
        lastError: null
      });
      this.logger.info(
        `[scraper] synced account=${accountId} total_ms=${Date.now() - startedAt} work_videos_ms=${payload.metrics.workVideosMs} task_cards_ms=${payload.metrics.taskCardsMs} task_details_ms=${payload.metrics.taskDetailsMs} tasks=${payload.tasks.length} videos=${payload.videos.length} requests=${payload.metrics.requestCount} retries=${payload.metrics.retryCount}`
      );
    } catch (error) {
      this.db.updateAccountStatus(accountId, {
        loginStatus: error instanceof SessionExpiredError ? "expired" : "error",
        lastError: toUserErrorMessage(error)
      });
      throw error;
    }
  }

  private async runLoginFlow(account: AccountRecord) {
    const context = await this.openPersistentContext(account, false);

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(CREATOR_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.bringToFront();
      await this.waitForLogin(page);

      this.db.updateAccountStatus(account.id, {
        loginStatus: "active",
        lastError: null
      });

      const accountIdentity = await this.fetchAccountIdentity(page).catch(() => null);
      if (accountIdentity?.displayName) {
        this.db.updateAccountDisplayName(account.id, accountIdentity.displayName);
      }
    } finally {
      await context.close();
    }
  }

  private async waitForLogin(page: Page) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 5 * 60 * 1000) {
      const state = await probeCreatorLogin(page, this.requestLimiter);
      if (state.loggedIn) {
        return;
      }

      await page.waitForTimeout(2000);
    }

    throw new SessionExpiredError("扫码超时，请重新点击登录后再试");
  }

  private async scrapeCreatorData(account: AccountRecord): Promise<{
    accountIdentity: AccountIdentity;
    tasks: XingtuTaskRecord[];
    videos: VideoRecord[];
    links: Array<{ taskId: string; videoId: string }>;
    metrics: ScrapeMetrics;
  }> {
    const context = await this.openPersistentContext(account, true);

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(CREATOR_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(1500);
      await ensureLoggedIn(page, this.requestLimiter);

      const metrics: ScrapeMetrics = {
        requestCount: 0,
        retryCount: 0,
        workVideosMs: 0,
        taskCardsMs: 0,
        taskDetailsMs: 0
      };
      const workVideosStartedAt = Date.now();
      const workVideosPromise = this.fetchWorkVideos(page, account.id, metrics).then((payload) => {
        metrics.workVideosMs = Date.now() - workVideosStartedAt;
        return payload;
      });
      const taskCardsStartedAt = Date.now();
      const taskCardsPromise = this.fetchTaskCards(page, metrics).then((missions) => {
        metrics.taskCardsMs = Date.now() - taskCardsStartedAt;
        return missions;
      });
      const [workPayload, missions] = await Promise.all([workVideosPromise, taskCardsPromise]);
      const taskMap = new Map<string, XingtuTaskRecord>();
      const videoMap = new Map<string, VideoRecord>(workPayload.videos.map((video) => [video.record.id, video.record]));
      const linkMap = new Map<string, string>();

      const taskDetailsStartedAt = Date.now();
      const details = await mapWithConcurrency(missions, TASK_DETAIL_CONCURRENCY, (mission) =>
        this.fetchTaskDetailRows(page, account.id, mission, workPayload.videos, metrics)
      );
      metrics.taskDetailsMs = Date.now() - taskDetailsStartedAt;
      for (const result of details) {
        for (const task of result.tasks) {
          taskMap.set(task.id, task);
        }
        for (const video of result.videos) {
          videoMap.set(video.id, video);
        }
        for (const link of result.links) {
          linkMap.set(link.taskId, link.videoId);
        }
      }

      return {
        accountIdentity: workPayload.accountIdentity,
        tasks: [...taskMap.values()],
        videos: [...videoMap.values()],
        links: [...linkMap.entries()].map(([taskId, videoId]) => ({ taskId, videoId })),
        metrics
      };
    } finally {
      await context.close();
    }
  }

  private async fetchTaskCards(page: Page, metrics: ScrapeMetrics): Promise<MissionCard[]> {
    const missions = new Map<string, MissionCard>();
    const statuses: Array<number | null> = [null, 1, 2, 3];

    for (const status of statuses) {
      let cursor: number | string = 0;

      for (let loops = 0; loops < 20; loops += 1) {
        const url = new URL(TASK_LIST_API);
        url.searchParams.set("cursor", String(cursor));
        url.searchParams.set("limit", "24");
        url.searchParams.set("mission_type", "1");
        if (status !== null) {
          url.searchParams.set("mission_status", String(status));
        }

        const payload = (await fetchLooseJson(page, url.toString(), metrics, this.requestLimiter)) as MissionListPayload;
        const apiStatus = payload.base_resp?.status_code ?? payload.status_code;
        if (apiStatus === 8 || apiStatus === 11001) {
          throw new SessionExpiredError(payload.base_resp?.status_message ?? payload.status_message ?? "登录失效");
        }

        const cards = payload.mission_cards ?? [];
        for (const card of cards) {
          if (card.id_str) {
            missions.set(card.id_str, card);
          }
        }

        if (!payload.has_more || !payload.next_cursor || cards.length === 0) {
          break;
        }

        cursor = payload.next_cursor;
      }
    }

    return [...missions.values()];
  }

  private async fetchTaskDetailRows(
    page: Page,
    accountId: string,
    mission: MissionCard,
    workVideos: WorkVideoCandidate[],
    metrics: ScrapeMetrics
  ): Promise<{
    tasks: XingtuTaskRecord[];
    videos: VideoRecord[];
    links: Array<{ taskId: string; videoId: string }>;
  }> {
    const missionId = normalizeText(mission.id_str);
    if (!missionId) {
      return { tasks: [], videos: [], links: [] };
    }

    const taskStatus = mapMissionStatus(mission.card_status);
    const summaryUrl = new URL(TASK_SUMMARY_API);
    summaryUrl.searchParams.set("challenge_id", missionId);
    const summary = (await fetchLooseJson(page, summaryUrl.toString(), metrics, this.requestLimiter)) as ChallengeSummaryPayload;
    if (summary.base_resp?.status_code && summary.base_resp.status_code !== 0) {
      throw new Error(summary.base_resp.status_message ?? `任务汇总请求失败：${missionId}`);
    }
    const missionEstimatedAmount = parseMissionEstimatedAmount(summary);
    const tasks: XingtuTaskRecord[] = [];
    const videos: VideoRecord[] = [];
    const links: Array<{ taskId: string; videoId: string }> = [];

    for (let pageNumber = 1; pageNumber <= 20; pageNumber += 1) {
      const url = new URL(TASK_DETAIL_API);
      url.searchParams.set("challenge_id", missionId);
      url.searchParams.set("page", String(pageNumber));
      url.searchParams.set("limit", "10");

      const payload = (await fetchLooseJson(page, url.toString(), metrics, this.requestLimiter)) as ChallengeOrderPayload;
      if (payload.base_resp?.status_code && payload.base_resp.status_code !== 0) {
        throw new Error(payload.base_resp.status_message ?? `任务详情请求失败：${missionId}`);
      }

      const orders = payload.orders ?? [];
      if (orders.length === 0) {
        break;
      }

      for (const row of orders) {
        const item = row.item;
        if (!item) {
          continue;
        }

        const videoRecordId = normalizeText(item.video_id) ?? normalizeText(String(item.item_id ?? ""));
        if (!videoRecordId) {
          continue;
        }
        const scopedVideoRecordId = buildScopedVideoId(accountId, videoRecordId);

        const title = normalizeText(item.title) ?? "暂无标题";
        const publishedAt = toIsoString(item.create_time);
        const sourceUrl =
          normalizeText(item.url) ??
          (item.item_id ? `https://www.iesdouyin.com/share/video/${String(item.item_id)}` : null);
        const xingtuPlayCount = parseNumber(item.play) ?? parseNumber(item.data?.offline_natural_effect_data?.watch_cnt);
        const predictedAmount = parseTaskMoney(item.reward_amount) ?? parseTaskMoney(item.est_reward_amount);
        const settledAmount = parseTaskMoney(item.author_total_share);
        const audit = readAuditResult(item);
        const videoStatus = audit.videoStatus !== "unknown" ? audit.videoStatus : "published";
        const taskId = buildScopedTaskId(accountId, missionId, videoRecordId);
        const matchedWorkVideo = this.matchWorkVideo(item, title, publishedAt, workVideos);
        const linkedVideoId = matchedWorkVideo?.record.id ?? scopedVideoRecordId;

        tasks.push({
          id: taskId,
          missionId,
          accountId,
          taskName: normalizeText(mission.name) ?? `任务 ${missionId}`,
          videoTitle: title,
          coverUrl: null,
          publishedAt,
          xingtuPlayCount,
          predictedAmount,
          missionEstimatedAmount,
          settledAmount,
          taskStatus,
          sourceUrl
        });

        if (!matchedWorkVideo) {
          videos.push({
            id: scopedVideoRecordId,
            accountId,
            title,
            coverUrl: null,
            publishedAt,
            actualPlayCount: null,
            videoStatus,
            sourceUrl
          });
        }

        links.push({ taskId, videoId: linkedVideoId });
      }
    }

    return { tasks, videos, links };
  }

  private async fetchWorkVideos(page: Page, accountId: string, metrics: ScrapeMetrics): Promise<{
    accountIdentity: AccountIdentity;
    videos: WorkVideoCandidate[];
  }> {
    const videos: WorkVideoCandidate[] = [];
    let displayName: string | null = null;
    let cursor: number | string = 0;

    for (let loops = 0; loops < 50; loops += 1) {
      const url = new URL(WORK_LIST_API);
      url.searchParams.set("status", "0");
      url.searchParams.set("count", "50");
      url.searchParams.set("max_cursor", String(cursor));
      url.searchParams.set("scene", "star_atlas");
      url.searchParams.set("device_platform", "android");
      url.searchParams.set("aid", "1128");

      const payload = (await fetchLooseJson(page, url.toString(), metrics, this.requestLimiter)) as WorkListPayload;
      if (payload.status_code === 8 || payload.status_code === 11001) {
        throw new SessionExpiredError(payload.status_msg ?? "登录失效");
      }
      if (payload.status_code && payload.status_code !== 0) {
        throw new Error(payload.status_msg ?? "作品管理请求失败");
      }

      const awemeList = payload.aweme_list ?? [];
      for (const item of awemeList) {
        displayName ??= normalizeText(item.author?.nickname);
        const awemeId = normalizeText(String(item.aweme_id ?? ""));
        const itemId = normalizeText(String(item.item_id ?? ""));
        const sourceUrl = normalizeText(item.share_url);
        const recordId = awemeId ?? parseAwemeIdFromUrl(sourceUrl) ?? itemId;
        if (!recordId) {
          continue;
        }
        const scopedRecordId = buildScopedVideoId(accountId, recordId);

        const title = normalizeText(item.caption) ?? normalizeText(item.desc) ?? "暂无标题";
        const publishedAt = toIsoString(item.create_time);

        videos.push({
          record: {
            id: scopedRecordId,
            accountId,
            title,
            coverUrl: null,
            publishedAt,
            actualPlayCount: parseNumber(item.statistics?.play_count),
            videoStatus: mapWorkVideoStatus(item),
            sourceUrl
          },
          awemeId: awemeId ?? parseAwemeIdFromUrl(sourceUrl),
          itemId,
          normalizedTitle: normalizeComparableTitle(title),
          publishedAtMs: toEpochMillis(item.create_time)
        });
      }

      if (!payload.has_more || !payload.max_cursor || awemeList.length === 0) {
        break;
      }

      cursor = payload.max_cursor;
    }

    if (!displayName) {
      const fallbackIdentity = await this.fetchAccountIdentity(page);
      displayName = fallbackIdentity.displayName;
    }

    return {
      accountIdentity: { displayName },
      videos
    };
  }

  private matchWorkVideo(
    item: ChallengeOrder,
    title: string,
    publishedAt: string | null,
    workVideos: WorkVideoCandidate[]
  ): WorkVideoCandidate | null {
    const awemeId = parseAwemeIdFromUrl(normalizeText(item.url));
    if (awemeId) {
      const byAwemeId = workVideos.find((video) => video.awemeId === awemeId);
      if (byAwemeId) {
        return byAwemeId;
      }
    }

    const itemId = normalizeText(String(item.item_id ?? ""));
    if (itemId) {
      const byItemId = workVideos.find((video) => video.itemId === itemId);
      if (byItemId) {
        return byItemId;
      }
    }

    const normalizedTitle = normalizeComparableTitle(title === "暂无标题" ? null : title);
    const publishedAtMs = toEpochMillis(publishedAt);
    if (!normalizedTitle || publishedAtMs === null) {
      return null;
    }

    let bestMatch: WorkVideoCandidate | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;

    for (const candidate of workVideos) {
      if (candidate.normalizedTitle !== normalizedTitle || candidate.publishedAtMs === null) {
        continue;
      }

      const diff = Math.abs(candidate.publishedAtMs - publishedAtMs);
      if (diff > 15 * 60 * 1000) {
        continue;
      }

      if (diff < bestDiff) {
        bestDiff = diff;
        bestMatch = candidate;
      }
    }

    return bestMatch;
  }

  private async fetchAccountIdentity(page: Page): Promise<AccountIdentity> {
    await page.goto("https://creator.douyin.com/creator-micro/home", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await page.waitForTimeout(2000);
    await ensureLoggedIn(page, this.requestLimiter);

    const displayName = await page.evaluate(() => {
      const text = document.body.innerText;
      const nicknameMatch = text.match(/抖音\s+([^\n]+)\n抖音号：/);
      if (nicknameMatch?.[1]) {
        const candidate = nicknameMatch[1].trim();
        return candidate || null;
      }

      return null;
    });

    return {
      displayName: normalizeText(displayName)
    };
  }

  private async openPersistentContext(account: AccountRecord, headless: boolean): Promise<BrowserContext> {
    fs.mkdirSync(account.sessionDir, { recursive: true });

    const launchOptions = {
      headless,
      viewport: { width: 1440, height: 960 },
      args: headless ? ["--headless=new", "--window-position=-32000,-32000", "--window-size=1440,960"] : []
    };

    const launchContext = () => {
      if (this.chromeExecutablePath) {
        return chromium.launchPersistentContext(account.sessionDir, {
          ...launchOptions,
          executablePath: this.chromeExecutablePath
        });
      }

      return chromium.launchPersistentContext(account.sessionDir, launchOptions);
    };

    try {
      return await launchContext();
    } catch (error) {
      if (!isRecoverableLaunchError(error)) {
        throw error;
      }

      terminateSessionBrowserProcesses(account.sessionDir);
      cleanupSessionArtifacts(account.sessionDir);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return launchContext();
    }
  }
}
