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
const WORKS_MANAGE_URL = "https://creator.douyin.com/creator-micro/content/manage";
const TASK_LIST_API = "https://creator.douyin.com/aweme/v1/creator/mission/mine/card/list/";
const TASK_DETAIL_API =
  "https://creator.douyin.com/web/api/third_party/star/gw/api/challenge/author_get_challenge_order_list";
const TASK_SUMMARY_API = "https://creator.douyin.com/web/api/third_party/star/gw/api/challenge/author_get_challenge";
const WORK_LIST_API = "https://creator.douyin.com/janus/douyin/creator/pc/work_list";
const SESSION_LOCK_FILENAMES = ["SingletonCookie", "SingletonLock", "SingletonSocket", "lockfile", "DevToolsActivePort"];

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

export class SessionExpiredError extends Error {}

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

function buildTaskDetailPageUrl(missionId: string): string {
  return `https://creator.douyin.com/creator-micro/revenue/redirect/task/submission/detail/${missionId}?from=my_task&utm_source=creator_center&utm_medium=pc_creator_center&front_source=pc_creator_center`;
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

async function fetchLooseJson(page: Page, url: string): Promise<unknown> {
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
    throw new Error(`请求失败(${payload.status})：${url}`);
  }

  return JSON.parse(payload.text);
}

async function probeCreatorLogin(page: Page): Promise<LoginState> {
  try {
    const probeUrl = new URL(TASK_LIST_API);
    probeUrl.searchParams.set("cursor", "0");
    probeUrl.searchParams.set("limit", "1");
    probeUrl.searchParams.set("mission_type", "1");

    const payload = (await fetchLooseJson(page, probeUrl.toString())) as MissionListPayload;
    const apiStatus = payload.base_resp?.status_code ?? payload.status_code;
    const apiMessage = payload.base_resp?.status_message ?? payload.status_message;

    if (apiStatus === 8 || apiStatus === 11001) {
      return {
        loggedIn: false,
        message: apiMessage ?? "创作者中心未登录，请扫码登录"
      };
    }

    return {
      loggedIn: true,
      message: "创作者中心已登录"
    };
  } catch (error) {
    return {
      loggedIn: false,
      message: toUserErrorMessage(error)
    };
  }
}

async function ensureLoggedIn(page: Page) {
  const state = await probeCreatorLogin(page);
  if (!state.loggedIn) {
    throw new SessionExpiredError(state.message);
  }
}

export class ScraperService {
  private readonly loginJobs = new Map<string, Promise<void>>();
  private readonly syncJobs = new Map<string, Promise<void>>();
  private readonly chromeExecutablePath = resolveChromeExecutablePath();

  constructor(private readonly db: AppDatabase) {}

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
      const accountIdentity = await this.fetchAccountIdentity(page);
      if (accountIdentity.displayName) {
        this.db.updateAccountDisplayName(account.id, accountIdentity.displayName);
      }

      this.db.updateAccountStatus(account.id, {
        loginStatus: "active",
        lastError: null
      });
    } finally {
      await context.close();
    }
  }

  private async waitForLogin(page: Page) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 5 * 60 * 1000) {
      const state = await probeCreatorLogin(page);
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
  }> {
    const context = await this.openPersistentContext(account, true);

    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(CREATOR_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(1500);
      await ensureLoggedIn(page);

      const workPayload = await this.fetchWorkVideos(page, account.id);
      const missions = await this.fetchTaskCards(page);
      const taskMap = new Map<string, XingtuTaskRecord>();
      const videoMap = new Map<string, VideoRecord>(workPayload.videos.map((video) => [video.record.id, video.record]));
      const linkMap = new Map<string, string>();

      for (const mission of missions) {
        const result = await this.fetchTaskDetailRows(page, account.id, mission, workPayload.videos);
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
        links: [...linkMap.entries()].map(([taskId, videoId]) => ({ taskId, videoId }))
      };
    } finally {
      await context.close();
    }
  }

  private async fetchTaskCards(page: Page): Promise<MissionCard[]> {
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

        const payload = (await fetchLooseJson(page, url.toString())) as MissionListPayload;
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
    workVideos: WorkVideoCandidate[]
  ): Promise<{
    tasks: XingtuTaskRecord[];
    videos: VideoRecord[];
    links: Array<{ taskId: string; videoId: string }>;
  }> {
    const missionId = normalizeText(mission.id_str);
    if (!missionId) {
      return { tasks: [], videos: [], links: [] };
    }

    await page.goto(buildTaskDetailPageUrl(missionId), {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await page.waitForTimeout(2500);

    const taskStatus = mapMissionStatus(mission.card_status);
    const summaryUrl = new URL(TASK_SUMMARY_API);
    summaryUrl.searchParams.set("challenge_id", missionId);
    const summary = (await fetchLooseJson(page, summaryUrl.toString())) as ChallengeSummaryPayload;
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

      const payload = (await fetchLooseJson(page, url.toString())) as ChallengeOrderPayload;
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

  private async fetchWorkVideos(page: Page, accountId: string): Promise<{
    accountIdentity: AccountIdentity;
    videos: WorkVideoCandidate[];
  }> {
    await page.goto(WORKS_MANAGE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2500);
    await ensureLoggedIn(page);

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

      const payload = (await fetchLooseJson(page, url.toString())) as WorkListPayload;
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
    await ensureLoggedIn(page);

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
      if (!headless || !isRecoverableLaunchError(error)) {
        throw error;
      }

      terminateSessionBrowserProcesses(account.sessionDir);
      cleanupSessionArtifacts(account.sessionDir);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return launchContext();
    }
  }
}
