import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AccountRecord,
  TaskVideoRow,
  VideoRecord,
  XingtuTaskRecord
} from "../domain/types.js";
import { getPreviousDateKey, getShanghaiDateKey } from "../domain/dailyEstimate.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..", "..", "..");
const dataDir = path.join(projectRoot, ".local-data");
const sessionsDir = path.join(dataDir, "sessions");

fs.mkdirSync(sessionsDir, { recursive: true });

type AccountRow = {
  id: string;
  display_name: string;
  platform: string;
  session_dir: string;
  login_status: string;
  last_sync_at: string | null;
  last_error: string | null;
};

export type DailyEstimateSummary = {
  yesterdayEstimatedTotal: number | null;
  todayEstimatedTotal: number;
  dailyIncrease: number | null;
};

function mapAccount(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    platform: row.platform,
    sessionDir: row.session_dir,
    loginStatus: row.login_status,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error
  };
}

export class AppDatabase {
  private readonly db: Database.Database;

  constructor(databasePath = path.join(dataDir, "app.db")) {
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.initialize();
  }

  getSessionsDir(): string {
    return sessionsDir;
  }

  private initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        platform TEXT NOT NULL,
        session_dir TEXT NOT NULL,
        login_status TEXT NOT NULL,
        last_sync_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS videos (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        title TEXT NOT NULL,
        cover_url TEXT,
        published_at TEXT,
        actual_play_count INTEGER,
        video_status TEXT NOT NULL,
        source_url TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      );

      CREATE TABLE IF NOT EXISTS xingtu_tasks (
        id TEXT PRIMARY KEY,
        mission_id TEXT,
        account_id TEXT NOT NULL,
        task_name TEXT NOT NULL,
        video_title TEXT,
        cover_url TEXT,
        published_at TEXT,
        xingtu_play_count INTEGER,
        predicted_amount REAL,
        mission_estimated_amount REAL,
        settled_amount REAL,
        task_status TEXT NOT NULL,
        source_url TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      );

      CREATE TABLE IF NOT EXISTS task_video_links (
        task_id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL,
        match_source TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES xingtu_tasks(id),
        FOREIGN KEY (video_id) REFERENCES videos(id)
      );

      CREATE TABLE IF NOT EXISTS task_estimate_snapshots (
        snapshot_date TEXT NOT NULL,
        account_id TEXT NOT NULL,
        mission_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        opening_predicted_amount REAL,
        predicted_amount REAL,
        captured_at TEXT NOT NULL,
        PRIMARY KEY (snapshot_date, task_id),
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      );
    `);

    this.ensureColumn("xingtu_tasks", "mission_id", "TEXT");
    this.ensureColumn("xingtu_tasks", "mission_estimated_amount", "REAL");
    this.ensureColumn("task_estimate_snapshots", "opening_predicted_amount", "REAL");
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_xingtu_tasks_account_mission
      ON xingtu_tasks(account_id, mission_id)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_task_estimate_snapshots_account_date
      ON task_estimate_snapshots(account_id, snapshot_date)
    `);
    this.db.exec(`
      UPDATE xingtu_tasks
      SET mission_id = CASE
        WHEN instr(id, ':') > 0 THEN substr(id, 1, instr(id, ':') - 1)
        ELSE id
      END
      WHERE mission_id IS NULL OR mission_id = ''
    `);
    this.db.exec(`
      UPDATE task_estimate_snapshots
      SET opening_predicted_amount = predicted_amount
      WHERE opening_predicted_amount IS NULL
    `);
  }

  private ensureColumn(tableName: string, columnName: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }

  listAccounts(): AccountRecord[] {
    const rows = this.db
      .prepare(`
        SELECT id, display_name, platform, session_dir, login_status, last_sync_at, last_error
        FROM accounts
        ORDER BY created_at DESC
      `)
      .all() as AccountRow[];

    return rows.map(mapAccount);
  }

  getAccount(accountId: string): AccountRecord | null {
    const row = this.db
      .prepare(`
        SELECT id, display_name, platform, session_dir, login_status, last_sync_at, last_error
        FROM accounts
        WHERE id = ?
      `)
      .get(accountId) as AccountRow | undefined;

    return row ? mapAccount(row) : null;
  }

  createAccount(displayName: string): AccountRecord {
    const id = `acct_${Date.now()}`;
    const sessionDir = path.join(sessionsDir, id);
    const now = new Date().toISOString();
    fs.mkdirSync(sessionDir, { recursive: true });

    this.db
      .prepare(`
        INSERT INTO accounts (id, display_name, platform, session_dir, login_status, last_sync_at, last_error, created_at)
        VALUES (?, ?, 'douyin', ?, 'never_logged_in', NULL, NULL, ?)
      `)
      .run(id, displayName, sessionDir, now);

    return this.getAccount(id)!;
  }

  deleteAccount(accountId: string) {
    const account = this.getAccount(accountId);
    if (!account) {
      throw new Error("账号不存在");
    }

    const transaction = this.db.transaction(() => {
      this.clearAccountData(accountId);
      this.db.prepare(`DELETE FROM task_estimate_snapshots WHERE account_id = ?`).run(accountId);
      this.db.prepare(`DELETE FROM accounts WHERE id = ?`).run(accountId);
    });

    transaction();
    fs.rmSync(account.sessionDir, { recursive: true, force: true });
  }

  updateAccountStatus(
    accountId: string,
    updates: {
      loginStatus?: string;
      lastSyncAt?: string | null;
      lastError?: string | null;
    }
  ) {
    const current = this.getAccount(accountId);
    if (!current) {
      throw new Error("账号不存在");
    }

    this.db
      .prepare(`
        UPDATE accounts
        SET login_status = ?, last_sync_at = ?, last_error = ?
        WHERE id = ?
      `)
      .run(
        updates.loginStatus ?? current.loginStatus,
        updates.lastSyncAt === undefined ? current.lastSyncAt : updates.lastSyncAt,
        updates.lastError === undefined ? current.lastError : updates.lastError,
        accountId
      );
  }

  updateAccountDisplayName(accountId: string, displayName: string) {
    const current = this.getAccount(accountId);
    if (!current) {
      throw new Error("账号不存在");
    }

    this.db
      .prepare(`
        UPDATE accounts
        SET display_name = ?
        WHERE id = ?
      `)
      .run(displayName, accountId);
  }

  replaceAccountSyncData(
    accountId: string,
    payload: {
      tasks: XingtuTaskRecord[];
      videos: VideoRecord[];
      links: Array<{ taskId: string; videoId: string }>;
    },
    syncedAt = new Date()
  ) {
    const insertVideo = this.db.prepare(`
      INSERT INTO videos (id, account_id, title, cover_url, published_at, actual_play_count, video_status, source_url, updated_at)
      VALUES (@id, @accountId, @title, @coverUrl, @publishedAt, @actualPlayCount, @videoStatus, @sourceUrl, @updatedAt)
    `);

    const insertTask = this.db.prepare(`
      INSERT INTO xingtu_tasks (
        id, mission_id, account_id, task_name, video_title, cover_url, published_at, xingtu_play_count,
        predicted_amount, mission_estimated_amount, settled_amount, task_status, source_url, updated_at
      )
      VALUES (
        @id, @missionId, @accountId, @taskName, @videoTitle, @coverUrl, @publishedAt, @xingtuPlayCount,
        @predictedAmount, @missionEstimatedAmount, @settledAmount, @taskStatus, @sourceUrl, @updatedAt
      )
    `);

    const insertLink = this.db.prepare(`
      INSERT INTO task_video_links (task_id, video_id, match_source, updated_at)
      VALUES (?, ?, 'auto', ?)
    `);

    const replaceSnapshot = this.db.prepare(`
      INSERT INTO task_estimate_snapshots (
        snapshot_date, account_id, mission_id, task_id, opening_predicted_amount, predicted_amount, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(snapshot_date, task_id) DO UPDATE SET
        predicted_amount = excluded.predicted_amount,
        captured_at = excluded.captured_at
    `);

    const now = syncedAt.toISOString();
    const snapshotDate = getShanghaiDateKey(syncedAt);
    const transaction = this.db.transaction(() => {
      this.clearAccountData(accountId);

      for (const video of payload.videos) {
        insertVideo.run({
          ...video,
          updatedAt: now
        });
      }

      for (const task of payload.tasks) {
        insertTask.run({
          ...task,
          updatedAt: now
        });
        replaceSnapshot.run(snapshotDate, accountId, task.missionId, task.id, task.predictedAmount, task.predictedAmount, now);
      }

      for (const link of payload.links) {
        insertLink.run(link.taskId, link.videoId, now);
      }
    });

    transaction();
  }

  private clearAccountData(accountId: string) {
    this.db
      .prepare(`
        DELETE FROM task_video_links
        WHERE task_id IN (SELECT id FROM xingtu_tasks WHERE account_id = ?)
           OR video_id IN (SELECT id FROM videos WHERE account_id = ?)
      `)
      .run(accountId, accountId);

    this.db.prepare(`DELETE FROM xingtu_tasks WHERE account_id = ?`).run(accountId);
    this.db.prepare(`DELETE FROM videos WHERE account_id = ?`).run(accountId);
  }

  saveManualLink(taskId: string, videoId: string) {
    const taskExists = this.db.prepare(`SELECT 1 FROM xingtu_tasks WHERE id = ?`).get(taskId);
    const videoExists = this.db.prepare(`SELECT 1 FROM videos WHERE id = ?`).get(videoId);
    if (!taskExists || !videoExists) {
      throw new Error("任务或视频不存在");
    }

    this.db
      .prepare(`
        INSERT INTO task_video_links (task_id, video_id, match_source, updated_at)
        VALUES (?, ?, 'manual', ?)
        ON CONFLICT(task_id) DO UPDATE SET
          video_id = excluded.video_id,
          match_source = excluded.match_source,
          updated_at = excluded.updated_at
      `)
      .run(taskId, videoId, new Date().toISOString());
  }

  listTasksByAccount(accountId: string): XingtuTaskRecord[] {
    return this.db
      .prepare(`
        SELECT
          id,
          mission_id as missionId,
          account_id as accountId,
          task_name as taskName,
          video_title as videoTitle,
          cover_url as coverUrl,
          published_at as publishedAt,
          xingtu_play_count as xingtuPlayCount,
          predicted_amount as predictedAmount,
          mission_estimated_amount as missionEstimatedAmount,
          settled_amount as settledAmount,
          task_status as taskStatus,
          source_url as sourceUrl
        FROM xingtu_tasks
        WHERE account_id = ?
      `)
      .all(accountId) as XingtuTaskRecord[];
  }

  listVideosByAccount(accountId: string): VideoRecord[] {
    return this.db
      .prepare(`
        SELECT
          id,
          account_id as accountId,
          title,
          cover_url as coverUrl,
          published_at as publishedAt,
          actual_play_count as actualPlayCount,
          video_status as videoStatus,
          source_url as sourceUrl
        FROM videos
        WHERE account_id = ?
      `)
      .all(accountId) as VideoRecord[];
  }

  listTaskVideoRows(filters: { accountId?: string; status?: string }): TaskVideoRow[] {
    const clauses: string[] = [];
    const params: Array<string> = [];

    if (filters.accountId) {
      clauses.push("t.account_id = ?");
      params.push(filters.accountId);
    }
    if (filters.status) {
      clauses.push("t.task_status = ?");
      params.push(filters.status);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const yesterdayDate = getPreviousDateKey(new Date());
    const todayDate = getShanghaiDateKey(new Date());

    return this.db
      .prepare(`
        WITH latest_yesterday_account_snapshots AS (
          SELECT account_id, MAX(captured_at) as captured_at
          FROM task_estimate_snapshots
          WHERE snapshot_date = ?
          GROUP BY account_id
        ),
        yesterday_snapshots AS (
          SELECT s.account_id, s.mission_id, s.task_id, s.predicted_amount
          FROM task_estimate_snapshots s
          INNER JOIN latest_yesterday_account_snapshots latest
            ON latest.account_id = s.account_id AND latest.captured_at = s.captured_at
          WHERE s.snapshot_date = ?
        ),
        yesterday_task_totals AS (
          SELECT account_id, mission_id, COALESCE(SUM(COALESCE(predicted_amount, 0)), 0) as predicted_amount
          FROM yesterday_snapshots
          GROUP BY account_id, mission_id
        ),
        today_snapshots AS (
          SELECT account_id, task_id, opening_predicted_amount, predicted_amount
          FROM task_estimate_snapshots
          WHERE snapshot_date = ?
        ),
        baseline_accounts AS (
          SELECT DISTINCT account_id
          FROM yesterday_snapshots
        )
        SELECT
          t.id as taskId,
          t.mission_id as missionId,
          l.video_id as videoId,
          t.account_id as accountId,
          a.display_name as accountName,
          t.task_name as taskName,
          COALESCE(v.title, t.video_title) as videoTitle,
          COALESCE(v.published_at, t.published_at) as publishedAt,
          t.xingtu_play_count as xingtuPlayCount,
          v.actual_play_count as actualPlayCount,
          CASE
            WHEN t.xingtu_play_count IS NULL OR v.actual_play_count IS NULL THEN NULL
            ELSE v.actual_play_count - t.xingtu_play_count
          END as playDelta,
          t.predicted_amount as predictedAmount,
          t.mission_estimated_amount as missionEstimatedAmount,
          CASE
            WHEN ba.account_id IS NULL THEN NULL
            WHEN ys.task_id IS NULL THEN 0
            ELSE ys.predicted_amount
          END as yesterdayPredictedAmount,
          ytt.predicted_amount as yesterdayTaskPredictedAmount,
          CASE WHEN ytt.account_id IS NULL THEN 0 ELSE 1 END as hasYesterdayTaskBaseline,
          CASE
            WHEN t.predicted_amount IS NULL THEN NULL
            WHEN ba.account_id IS NOT NULL AND ys.task_id IS NULL THEN t.predicted_amount
            WHEN ba.account_id IS NOT NULL AND ys.predicted_amount IS NULL THEN NULL
            WHEN ba.account_id IS NOT NULL THEN t.predicted_amount - ys.predicted_amount
            WHEN ts.task_id IS NULL OR ts.opening_predicted_amount IS NULL THEN NULL
            ELSE t.predicted_amount - ts.opening_predicted_amount
          END as todayPredictedDelta,
          t.settled_amount as settledAmount,
          v.video_status as videoStatus,
          t.task_status as taskStatus,
          a.last_sync_at as lastSyncedAt,
          l.match_source as matchSource
        FROM xingtu_tasks t
        INNER JOIN accounts a ON a.id = t.account_id
        LEFT JOIN task_video_links l ON l.task_id = t.id
        LEFT JOIN videos v ON v.id = l.video_id
        LEFT JOIN yesterday_snapshots ys ON ys.account_id = t.account_id AND ys.task_id = t.id
        LEFT JOIN yesterday_task_totals ytt ON ytt.account_id = t.account_id AND ytt.mission_id = t.mission_id
        LEFT JOIN today_snapshots ts ON ts.account_id = t.account_id AND ts.task_id = t.id
        LEFT JOIN baseline_accounts ba ON ba.account_id = t.account_id
        ${where}
        ORDER BY a.display_name ASC, t.task_name ASC, COALESCE(v.published_at, t.published_at) DESC, t.id ASC
      `)
      .all(yesterdayDate, yesterdayDate, todayDate, ...params) as TaskVideoRow[];
  }

  getDailyEstimateSummary(now = new Date()): DailyEstimateSummary {
    const yesterdayDate = getPreviousDateKey(now);
    const yesterday = this.db
      .prepare(`
        WITH latest_account_snapshots AS (
          SELECT account_id, MAX(captured_at) as captured_at
          FROM task_estimate_snapshots
          WHERE snapshot_date = ?
          GROUP BY account_id
        )
        SELECT
          COUNT(*) as snapshotCount,
          COALESCE(SUM(COALESCE(s.predicted_amount, 0)), 0) as total
        FROM task_estimate_snapshots s
        INNER JOIN latest_account_snapshots latest
          ON latest.account_id = s.account_id AND latest.captured_at = s.captured_at
        WHERE s.snapshot_date = ?
      `)
      .get(yesterdayDate, yesterdayDate) as { snapshotCount: number; total: number };
    const today = this.db
      .prepare(`
        SELECT COALESCE(SUM(COALESCE(predicted_amount, 0)), 0) as total
        FROM xingtu_tasks
      `)
      .get() as { total: number };
    const yesterdayEstimatedTotal = yesterday.snapshotCount === 0 ? null : yesterday.total;

    return {
      yesterdayEstimatedTotal,
      todayEstimatedTotal: today.total,
      dailyIncrease: yesterdayEstimatedTotal === null ? null : today.total - yesterdayEstimatedTotal
    };
  }
}
