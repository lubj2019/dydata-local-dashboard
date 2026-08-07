import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AccountRecord,
  TaskPlayGrowthPage,
  TaskPlayGrowthRow,
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
  douyin_id: string | null;
  platform: string;
  session_dir: string;
  login_status: string;
  last_sync_at: string | null;
  last_error: string | null;
  first_logged_in_at: string | null;
  archived_at: string | null;
};

export type DailyEstimateSummary = {
  yesterdayEstimatedTotal: number | null;
  todayEstimatedTotal: number | null;
  dailyIncrease: number | null;
  snapshotDate: string;
  expectedAccountCount: number;
  freshAccountCount: number;
  carriedForwardAccountCount: number;
  missingAccountCount: number;
  isComplete: boolean;
};

function mapAccount(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    douyinId: row.douyin_id,
    platform: row.platform,
    sessionDir: row.session_dir,
    loginStatus: row.login_status,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    firstLoggedInAt: row.first_logged_in_at,
    archivedAt: row.archived_at
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

  close() {
    this.db.close();
  }

  private initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        douyin_id TEXT,
        platform TEXT NOT NULL,
        session_dir TEXT NOT NULL,
        login_status TEXT NOT NULL,
        last_sync_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        first_logged_in_at TEXT,
        archived_at TEXT
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
        format_version INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (snapshot_date, task_id),
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      );

      CREATE TABLE IF NOT EXISTS task_play_snapshots (
        snapshot_date TEXT NOT NULL,
        account_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        actual_play_count INTEGER NOT NULL,
        captured_at TEXT NOT NULL,
        format_version INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (account_id, task_id, captured_at),
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      );

      CREATE TABLE IF NOT EXISTS daily_account_snapshots (
        id TEXT PRIMARY KEY,
        snapshot_date TEXT NOT NULL,
        account_id TEXT NOT NULL,
        status TEXT NOT NULL,
        source_snapshot_id TEXT,
        source_synced_at TEXT,
        captured_at TEXT NOT NULL,
        last_error TEXT,
        format_version INTEGER NOT NULL DEFAULT 1,
        UNIQUE (snapshot_date, account_id),
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      );

      CREATE TABLE IF NOT EXISTS daily_snapshot_tasks (
        snapshot_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
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
        PRIMARY KEY (snapshot_id, task_id),
        FOREIGN KEY (snapshot_id) REFERENCES daily_account_snapshots(id),
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      );

      CREATE TABLE IF NOT EXISTS daily_snapshot_videos (
        snapshot_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        title TEXT NOT NULL,
        cover_url TEXT,
        published_at TEXT,
        actual_play_count INTEGER,
        video_status TEXT NOT NULL,
        source_url TEXT,
        PRIMARY KEY (snapshot_id, video_id),
        FOREIGN KEY (snapshot_id) REFERENCES daily_account_snapshots(id),
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      );

      CREATE TABLE IF NOT EXISTS daily_snapshot_links (
        snapshot_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        match_source TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, task_id),
        FOREIGN KEY (snapshot_id) REFERENCES daily_account_snapshots(id)
      );

      CREATE TABLE IF NOT EXISTS app_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    this.ensureColumn("accounts", "douyin_id", "TEXT");
    this.ensureColumn("xingtu_tasks", "mission_id", "TEXT");
    this.ensureColumn("xingtu_tasks", "mission_estimated_amount", "REAL");
    this.ensureColumn("task_estimate_snapshots", "opening_predicted_amount", "REAL");
    this.ensureColumn("task_estimate_snapshots", "format_version", "INTEGER");
    this.ensureColumn("task_play_snapshots", "format_version", "INTEGER");
    this.ensureColumn("accounts", "first_logged_in_at", "TEXT");
    this.ensureColumn("accounts", "archived_at", "TEXT");
    this.db.exec(`
      UPDATE accounts
      SET first_logged_in_at = COALESCE(
        (SELECT MIN(captured_at) FROM task_estimate_snapshots WHERE account_id = accounts.id),
        (SELECT MIN(captured_at) FROM task_play_snapshots WHERE account_id = accounts.id),
        last_sync_at
      )
      WHERE first_logged_in_at IS NULL
        AND (
          last_sync_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM task_estimate_snapshots WHERE account_id = accounts.id)
          OR EXISTS (SELECT 1 FROM task_play_snapshots WHERE account_id = accounts.id)
        )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_xingtu_tasks_account_mission
      ON xingtu_tasks(account_id, mission_id)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_task_estimate_snapshots_account_date
      ON task_estimate_snapshots(account_id, snapshot_date)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_task_play_snapshots_account_date
      ON task_play_snapshots(account_id, snapshot_date, captured_at)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_daily_account_snapshots_account_date
      ON daily_account_snapshots(account_id, snapshot_date)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_daily_snapshot_tasks_snapshot
      ON daily_snapshot_tasks(snapshot_id)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_daily_snapshot_videos_snapshot
      ON daily_snapshot_videos(snapshot_id)
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
    this.db.exec(`
      UPDATE task_estimate_snapshots SET format_version = 0 WHERE format_version IS NULL;
      UPDATE task_play_snapshots SET format_version = 0 WHERE format_version IS NULL;
    `);
    this.applyMigration("queue_existing_expired_accounts_for_session_recheck", () => {
      this.db.prepare(`UPDATE accounts SET login_status = 'session_recheck_pending' WHERE login_status = 'expired'`).run();
    });
    this.applyMigration("queue_xingtu_login_errors_for_session_recheck", () => {
      this.db
        .prepare(`
          UPDATE accounts
          SET login_status = 'session_recheck_pending'
          WHERE login_status = 'expired'
            AND (
              last_error LIKE '%用户未登录%'
              OR last_error LIKE '%登录失效%'
              OR last_error LIKE '%登录过期%'
            )
        `)
        .run();
    });
    this.applyMigration("require_xingtu_login_after_retryable_xingtu_failure", () => {
      this.db
        .prepare(`
          UPDATE accounts
          SET
            login_status = 'xingtu_login_required',
            last_error = '星图会话未登录，请重新登录巨量星图后再同步。'
          WHERE login_status IN ('active', 'session_recheck_pending')
            AND last_error LIKE '%用户未登录%'
        `)
        .run();
    });
  }

  private applyMigration(name: string, apply: () => void) {
    const exists = this.db.prepare(`SELECT 1 FROM app_migrations WHERE name = ?`).get(name);
    if (exists) {
      return;
    }

    this.db.transaction(() => {
      apply();
      this.db.prepare(`INSERT INTO app_migrations (name, applied_at) VALUES (?, ?)`).run(name, new Date().toISOString());
    })();
  }

  private ensureColumn(tableName: string, columnName: string, definition: string) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }

  listAccounts(options: { includeArchived?: boolean } = {}): AccountRecord[] {
    const where = options.includeArchived ? "" : "WHERE archived_at IS NULL";
    const rows = this.db
      .prepare(`
        SELECT id, display_name, douyin_id, platform, session_dir, login_status, last_sync_at, last_error,
               first_logged_in_at, archived_at
        FROM accounts
        ${where}
        ORDER BY created_at DESC
      `)
      .all() as AccountRow[];

    return rows.map(mapAccount);
  }

  getAccount(accountId: string): AccountRecord | null {
    const row = this.db
      .prepare(`
        SELECT id, display_name, douyin_id, platform, session_dir, login_status, last_sync_at, last_error,
               first_logged_in_at, archived_at
        FROM accounts
        WHERE id = ?
      `)
      .get(accountId) as AccountRow | undefined;

    return row ? mapAccount(row) : null;
  }

  createAccount(displayName: string): AccountRecord {
    const id = `acct_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sessionDir = path.join(sessionsDir, id);
    const now = new Date().toISOString();
    fs.mkdirSync(sessionDir, { recursive: true });

    this.db
      .prepare(`
        INSERT INTO accounts (
          id, display_name, platform, session_dir, login_status, last_sync_at, last_error,
          created_at, first_logged_in_at, archived_at
        )
        VALUES (?, ?, 'douyin', ?, 'never_logged_in', NULL, NULL, ?, NULL, NULL)
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
      this.db
        .prepare(`UPDATE accounts SET archived_at = ?, login_status = 'archived' WHERE id = ?`)
        .run(new Date().toISOString(), accountId);
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
        SET login_status = ?, last_sync_at = ?, last_error = ?,
            first_logged_in_at = CASE
              WHEN ? = 'active' THEN COALESCE(first_logged_in_at, ?)
              ELSE first_logged_in_at
            END
        WHERE id = ?
      `)
      .run(
        updates.loginStatus ?? current.loginStatus,
        updates.lastSyncAt === undefined ? current.lastSyncAt : updates.lastSyncAt,
        updates.lastError === undefined ? current.lastError : updates.lastError,
        updates.loginStatus ?? current.loginStatus,
        updates.lastSyncAt ?? new Date().toISOString(),
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

  updateAccountIdentity(accountId: string, identity: { displayName: string | null; douyinId: string | null }) {
    const current = this.getAccount(accountId);
    if (!current) {
      throw new Error("账号不存在");
    }

    this.db
      .prepare(`
        UPDATE accounts
        SET display_name = COALESCE(?, display_name), douyin_id = COALESCE(?, douyin_id)
        WHERE id = ?
      `)
      .run(identity.displayName, identity.douyinId, accountId);
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
        snapshot_date, account_id, mission_id, task_id, opening_predicted_amount, predicted_amount, captured_at, format_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(snapshot_date, task_id) DO UPDATE SET
        predicted_amount = excluded.predicted_amount,
        captured_at = excluded.captured_at
    `);

    const insertPlaySnapshot = this.db.prepare(`
      INSERT INTO task_play_snapshots (snapshot_date, account_id, task_id, actual_play_count, captured_at, format_version)
      VALUES (?, ?, ?, ?, ?, 0)
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

      const videosById = new Map(payload.videos.map((video) => [video.id, video]));
      for (const link of payload.links) {
        const actualPlayCount = videosById.get(link.videoId)?.actualPlayCount;
        if (actualPlayCount !== null && actualPlayCount !== undefined) {
          insertPlaySnapshot.run(snapshotDate, accountId, link.taskId, actualPlayCount, now);
        }
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

  finalizeDailySnapshots(snapshotDate: string, capturedAt = new Date()): {
    expected: number;
    fresh: number;
    carriedForward: number;
    missing: number;
  } {
    const capturedAtIso = capturedAt.toISOString();
    const accounts = this.listAccounts({ includeArchived: true }).filter(
      (account) =>
        account.firstLoggedInAt && getShanghaiDateKey(new Date(account.firstLoggedInAt)) <= snapshotDate
    );
    let fresh = 0;
    let carriedForward = 0;
    let missing = 0;

    const insertHeader = this.db.prepare(`
      INSERT INTO daily_account_snapshots (
        id, snapshot_date, account_id, status, source_snapshot_id, source_synced_at,
        captured_at, last_error, format_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const insertTask = this.db.prepare(`
      INSERT INTO daily_snapshot_tasks (
        snapshot_id, task_id, mission_id, account_id, task_name, video_title, cover_url,
        published_at, xingtu_play_count, predicted_amount, mission_estimated_amount,
        settled_amount, task_status, source_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertVideo = this.db.prepare(`
      INSERT INTO daily_snapshot_videos (
        snapshot_id, video_id, account_id, title, cover_url, published_at,
        actual_play_count, video_status, source_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertLink = this.db.prepare(`
      INSERT INTO daily_snapshot_links (snapshot_id, task_id, video_id, match_source)
      VALUES (?, ?, ?, ?)
    `);

    const copySnapshotDetails = (sourceSnapshotId: string, targetSnapshotId: string) => {
      const tasks = this.db
        .prepare(`SELECT * FROM daily_snapshot_tasks WHERE snapshot_id = ?`)
        .all(sourceSnapshotId) as Array<Record<string, unknown>>;
      for (const task of tasks) {
        insertTask.run(
          targetSnapshotId,
          task.task_id,
          task.mission_id,
          task.account_id,
          task.task_name,
          task.video_title,
          task.cover_url,
          task.published_at,
          task.xingtu_play_count,
          task.predicted_amount,
          task.mission_estimated_amount,
          task.settled_amount,
          task.task_status,
          task.source_url
        );
      }

      const videos = this.db
        .prepare(`SELECT * FROM daily_snapshot_videos WHERE snapshot_id = ?`)
        .all(sourceSnapshotId) as Array<Record<string, unknown>>;
      for (const video of videos) {
        insertVideo.run(
          targetSnapshotId,
          video.video_id,
          video.account_id,
          video.title,
          video.cover_url,
          video.published_at,
          video.actual_play_count,
          video.video_status,
          video.source_url
        );
      }

      const links = this.db
        .prepare(`SELECT * FROM daily_snapshot_links WHERE snapshot_id = ?`)
        .all(sourceSnapshotId) as Array<Record<string, unknown>>;
      for (const link of links) {
        insertLink.run(targetSnapshotId, link.task_id, link.video_id, link.match_source);
      }
    };

    const transaction = this.db.transaction(() => {
      for (const account of accounts) {
        const snapshotId = `${account.id}:${snapshotDate}`;
        const alreadyFinalized = this.db
          .prepare(`SELECT 1 FROM daily_account_snapshots WHERE id = ?`)
          .get(snapshotId);
        if (alreadyFinalized) {
          continue;
        }

        const syncedToday = account.lastSyncAt && getShanghaiDateKey(new Date(account.lastSyncAt)) === snapshotDate;
        let status: "fresh" | "carried_forward" | "missing" = "missing";
        let sourceSnapshotId: string | null = null;
        let sourceSyncedAt: string | null = null;
        let lastError: string | null = null;

        if (syncedToday) {
          status = "fresh";
          sourceSnapshotId = `current:${account.id}:${account.lastSyncAt}`;
          sourceSyncedAt = account.lastSyncAt;
          fresh += 1;
        } else {
          const previous = this.db
            .prepare(`
              SELECT id, source_synced_at, captured_at, last_error
              FROM daily_account_snapshots
              WHERE account_id = ? AND snapshot_date < ?
                AND status IN ('fresh', 'carried_forward')
              ORDER BY snapshot_date DESC
              LIMIT 1
            `)
            .get(account.id, snapshotDate) as {
              id: string;
              source_synced_at: string | null;
              captured_at: string;
              last_error: string | null;
            } | undefined;

          if (previous) {
            status = "carried_forward";
            sourceSnapshotId = previous.id;
            sourceSyncedAt = previous.source_synced_at ?? previous.captured_at;
            lastError = account.lastError ?? "当天未完成成功同步，沿用最近有效日快照。";
            carriedForward += 1;
          } else {
            lastError = account.lastError ?? "当天没有可沿用的历史快照。";
            missing += 1;
          }
        }

        insertHeader.run(
          snapshotId,
          snapshotDate,
          account.id,
          status,
          sourceSnapshotId,
          sourceSyncedAt,
          capturedAtIso,
          lastError
        );

        if (status === "fresh") {
          const tasks = this.db
            .prepare(`SELECT * FROM xingtu_tasks WHERE account_id = ?`)
            .all(account.id) as Array<Record<string, unknown>>;
          for (const task of tasks) {
            insertTask.run(
              snapshotId,
              task.id,
              task.mission_id,
              task.account_id,
              task.task_name,
              task.video_title,
              task.cover_url,
              task.published_at,
              task.xingtu_play_count,
              task.predicted_amount,
              task.mission_estimated_amount,
              task.settled_amount,
              task.task_status,
              task.source_url
            );
          }

          const videos = this.db
            .prepare(`SELECT * FROM videos WHERE account_id = ?`)
            .all(account.id) as Array<Record<string, unknown>>;
          for (const video of videos) {
            insertVideo.run(
              snapshotId,
              video.id,
              video.account_id,
              video.title,
              video.cover_url,
              video.published_at,
              video.actual_play_count,
              video.video_status,
              video.source_url
            );
          }

          const links = this.db
            .prepare(`
              SELECT l.task_id, l.video_id, l.match_source
              FROM task_video_links l
              INNER JOIN xingtu_tasks t ON t.id = l.task_id
              WHERE t.account_id = ?
            `)
            .all(account.id) as Array<Record<string, unknown>>;
          for (const link of links) {
            insertLink.run(snapshotId, link.task_id, link.video_id, link.match_source);
          }
        } else if (sourceSnapshotId) {
          copySnapshotDetails(sourceSnapshotId, snapshotId);
        }
      }
    });

    transaction();
    return { expected: accounts.length, fresh, carriedForward, missing };
  }

  getDailySnapshotCoverage(snapshotDate: string) {
    return this.db
      .prepare(`
        WITH eligible_accounts AS (
          SELECT id
          FROM accounts
          WHERE first_logged_in_at IS NOT NULL
            AND date(first_logged_in_at) <= date(?)
        ),
        resolved AS (
          SELECT
            a.id as account_id,
            current_snapshot.status as current_status,
            previous_snapshot.id as previous_id
          FROM eligible_accounts a
          LEFT JOIN daily_account_snapshots current_snapshot
            ON current_snapshot.account_id = a.id AND current_snapshot.snapshot_date = ?
          LEFT JOIN daily_account_snapshots previous_snapshot
            ON previous_snapshot.id = (
              SELECT id
              FROM daily_account_snapshots
              WHERE account_id = a.id
                AND snapshot_date < ?
                AND status IN ('fresh', 'carried_forward')
              ORDER BY snapshot_date DESC
              LIMIT 1
            )
        )
        SELECT
          COUNT(*) AS expected,
          COALESCE(SUM(CASE WHEN current_status = 'fresh' THEN 1 ELSE 0 END), 0) AS fresh,
          COALESCE(SUM(CASE
            WHEN current_status = 'carried_forward'
              OR ((current_status IS NULL OR current_status = 'missing') AND previous_id IS NOT NULL) THEN 1
            ELSE 0
          END), 0) AS carriedForward,
          COALESCE(SUM(CASE
            WHEN current_status IS NULL OR current_status = 'missing'
              THEN CASE WHEN previous_id IS NULL THEN 1 ELSE 0 END
            ELSE 0
          END), 0) AS missing
        FROM resolved
      `)
      .get(snapshotDate, snapshotDate, snapshotDate) as {
      expected: number;
      fresh: number;
      carriedForward: number;
      missing: number;
    };
  }

  getDailySnapshot(accountId: string, snapshotDate: string) {
    return this.db
      .prepare(`
        SELECT
          s.id,
          s.status,
          s.source_snapshot_id as sourceSnapshotId,
          s.source_synced_at as sourceSyncedAt,
          s.captured_at as capturedAt,
          s.last_error as lastError,
          (SELECT COUNT(*) FROM daily_snapshot_tasks t WHERE t.snapshot_id = s.id) as taskCount,
          (SELECT COUNT(*) FROM daily_snapshot_videos v WHERE v.snapshot_id = s.id) as videoCount,
          (SELECT COUNT(*) FROM daily_snapshot_links l WHERE l.snapshot_id = s.id) as linkCount
        FROM daily_account_snapshots s
        WHERE s.account_id = ? AND s.snapshot_date = ?
      `)
      .get(accountId, snapshotDate) as {
      id: string;
      status: string;
      sourceSnapshotId: string | null;
      sourceSyncedAt: string | null;
      capturedAt: string;
      lastError: string | null;
      taskCount: number;
      videoCount: number;
      linkCount: number;
    } | undefined;
  }

  getLatestUsableDailySnapshot(accountId: string, snapshotDate: string) {
    return this.db
      .prepare(`
        SELECT
          snapshot_date as snapshotDate,
          status,
          source_synced_at as sourceSyncedAt,
          last_error as lastError
        FROM daily_account_snapshots
        WHERE account_id = ?
          AND snapshot_date <= ?
          AND status IN ('fresh', 'carried_forward')
        ORDER BY snapshot_date DESC
        LIMIT 1
      `)
      .get(accountId, snapshotDate) as {
      snapshotDate: string;
      status: "fresh" | "carried_forward";
      sourceSyncedAt: string | null;
      lastError: string | null;
    } | undefined;
  }

  applyV1DashboardMigration() {
    this.applyMigration("v1_dashboard_data_model", () => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS v1_statistic_retention (
          account_id TEXT PRIMARY KEY,
          archived_at TEXT NOT NULL,
          preserved_at TEXT NOT NULL,
          FOREIGN KEY (account_id) REFERENCES accounts(id)
        )
      `);
      this.db
        .prepare(`
          INSERT INTO v1_statistic_retention (account_id, archived_at, preserved_at)
          SELECT id, archived_at, ?
          FROM accounts
          WHERE archived_at IS NOT NULL
          ON CONFLICT(account_id) DO NOTHING
        `)
        .run(new Date().toISOString());
    });
  }

  listV1StatisticRetention() {
    return this.db
      .prepare("SELECT account_id as accountId FROM v1_statistic_retention ORDER BY account_id")
      .all() as Array<{ accountId: string }>;
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
    const clauses = ["a.archived_at IS NULL"];
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

  listTaskPlayGrowthPage(page: number, pageSize: number, now = new Date()): TaskPlayGrowthPage {
    const previousDate = getPreviousDateKey(now);
    const total = (
      this.db
        .prepare(`
          SELECT COUNT(*) as count
          FROM xingtu_tasks t
          INNER JOIN accounts a ON a.id = t.account_id
          WHERE a.archived_at IS NULL
        `)
        .get() as { count: number }
    ).count;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(totalPages, Math.max(1, Math.floor(page)));
    const offset = (safePage - 1) * pageSize;

    const items = this.db
      .prepare(`
        WITH latest_sync_snapshots AS (
          SELECT account_id, MAX(captured_at) as captured_at
          FROM task_play_snapshots
          GROUP BY account_id
        ),
        previous_sync_snapshots AS (
          SELECT p.account_id, MAX(p.captured_at) as captured_at
          FROM task_play_snapshots p
          INNER JOIN latest_sync_snapshots latest ON latest.account_id = p.account_id
          WHERE p.captured_at < latest.captured_at
          GROUP BY p.account_id
        ),
        latest_yesterday_snapshots AS (
          SELECT account_id, MAX(captured_at) as captured_at
          FROM task_play_snapshots
          WHERE snapshot_date = ?
          GROUP BY account_id
        )
        SELECT
          a.display_name as accountName,
          v.actual_play_count as actualPlayCount,
          CASE
            WHEN v.actual_play_count IS NULL OR previous.actual_play_count IS NULL THEN NULL
            ELSE v.actual_play_count - previous.actual_play_count
          END as playGrowth,
          CASE
            WHEN v.actual_play_count IS NULL OR yesterday.actual_play_count IS NULL THEN NULL
            ELSE v.actual_play_count - yesterday.actual_play_count
          END as dailyPlayGrowth,
          COALESCE(v.published_at, t.published_at) as publishedAt,
          t.task_name as taskName
        FROM xingtu_tasks t
        INNER JOIN accounts a ON a.id = t.account_id
        LEFT JOIN task_video_links l ON l.task_id = t.id
        LEFT JOIN videos v ON v.id = l.video_id
        LEFT JOIN previous_sync_snapshots previousSync ON previousSync.account_id = t.account_id
        LEFT JOIN task_play_snapshots previous
          ON previous.account_id = t.account_id
          AND previous.task_id = t.id
          AND previous.captured_at = previousSync.captured_at
        LEFT JOIN latest_yesterday_snapshots yesterdaySync ON yesterdaySync.account_id = t.account_id
        LEFT JOIN task_play_snapshots yesterday
          ON yesterday.account_id = t.account_id
          AND yesterday.task_id = t.id
          AND yesterday.captured_at = yesterdaySync.captured_at
        WHERE a.archived_at IS NULL
        ORDER BY playGrowth IS NULL ASC, playGrowth DESC, actualPlayCount DESC, publishedAt DESC, t.id ASC
        LIMIT ? OFFSET ?
      `)
      .all(previousDate, pageSize, offset) as TaskPlayGrowthRow[];

    return { items, page: safePage, pageSize, total };
  }

  getDailyEstimateSummary(now = new Date()): DailyEstimateSummary {
    const yesterdayDate = getPreviousDateKey(now);
    const todayDate = getShanghaiDateKey(now);
    const hasDailySnapshots = (snapshotDate: string, includePrevious = false) =>
      (
        this.db
          .prepare(`
            SELECT COUNT(*) AS count
            FROM daily_account_snapshots
            WHERE snapshot_date ${includePrevious ? "<=" : "="} ?
          `)
          .get(snapshotDate) as { count: number }
      ).count > 0;

    const dailyTotal = (snapshotDate: string) =>
      this.db
        .prepare(`
          WITH eligible_accounts AS (
            SELECT id
            FROM accounts
            WHERE first_logged_in_at IS NOT NULL
              AND date(first_logged_in_at) <= date(?)
          ),
          resolved_snapshots AS (
            SELECT
              a.id as account_id,
              COALESCE(
                (
                  SELECT id
                  FROM daily_account_snapshots
                  WHERE account_id = a.id
                    AND snapshot_date = ?
                    AND status IN ('fresh', 'carried_forward')
                ),
                (
                  SELECT id
                  FROM daily_account_snapshots
                  WHERE account_id = a.id
                    AND snapshot_date < ?
                    AND status IN ('fresh', 'carried_forward')
                  ORDER BY snapshot_date DESC
                  LIMIT 1
                )
              ) as snapshot_id
            FROM eligible_accounts a
          ),
          resolved_totals AS (
            SELECT
              r.account_id,
              r.snapshot_id,
              COALESCE(SUM(t.predicted_amount), 0) as total
            FROM resolved_snapshots r
            LEFT JOIN daily_snapshot_tasks t ON t.snapshot_id = r.snapshot_id
            GROUP BY r.account_id, r.snapshot_id
          )
          SELECT
            COUNT(*) AS snapshotCount,
            COUNT(snapshot_id) AS usableCount,
            COALESCE(SUM(total), 0) AS total
          FROM resolved_totals
        `)
        .get(snapshotDate, snapshotDate, snapshotDate) as { snapshotCount: number; usableCount: number; total: number };

    const legacyYesterday = this.db
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
    const liveToday = this.db
      .prepare(`
        WITH current_accounts AS (
          SELECT DISTINCT account_id
          FROM xingtu_tasks
        ),
        current_total AS (
          SELECT COALESCE(SUM(COALESCE(mission_estimated_amount, 0)), 0) as total
          FROM (
            SELECT account_id, mission_id, MAX(mission_estimated_amount) as mission_estimated_amount
            FROM xingtu_tasks
            GROUP BY account_id, mission_id
          )
        ),
        latest_archived_snapshots AS (
          SELECT s.account_id, MAX(s.snapshot_date) as snapshot_date
          FROM daily_account_snapshots s
          INNER JOIN accounts a ON a.id = s.account_id
          WHERE a.archived_at IS NOT NULL
            AND s.snapshot_date <= ?
            AND s.status IN ('fresh', 'carried_forward')
            AND NOT EXISTS (
              SELECT 1 FROM current_accounts c WHERE c.account_id = s.account_id
            )
          GROUP BY s.account_id
        ),
        archived_snapshot_total AS (
          SELECT COALESCE(SUM(COALESCE(t.predicted_amount, 0)), 0) as total
          FROM latest_archived_snapshots latest
          INNER JOIN daily_account_snapshots s
            ON s.account_id = latest.account_id AND s.snapshot_date = latest.snapshot_date
          LEFT JOIN daily_snapshot_tasks t ON t.snapshot_id = s.id
        ),
        latest_archived_estimate_snapshots AS (
          SELECT s.account_id, MAX(s.captured_at) as captured_at
          FROM task_estimate_snapshots s
          INNER JOIN accounts a ON a.id = s.account_id
          WHERE a.archived_at IS NOT NULL
            AND s.snapshot_date <= ?
            AND NOT EXISTS (
              SELECT 1 FROM current_accounts c WHERE c.account_id = s.account_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM latest_archived_snapshots d WHERE d.account_id = s.account_id
            )
          GROUP BY s.account_id
        ),
        archived_estimate_snapshot_total AS (
          SELECT COALESCE(SUM(COALESCE(s.predicted_amount, 0)), 0) as total
          FROM latest_archived_estimate_snapshots latest
          INNER JOIN task_estimate_snapshots s
            ON s.account_id = latest.account_id AND s.captured_at = latest.captured_at
        )
        SELECT
          current_total.total + archived_snapshot_total.total + archived_estimate_snapshot_total.total as total
        FROM current_total, archived_snapshot_total, archived_estimate_snapshot_total
      `)
      .get(todayDate, todayDate) as { total: number };

    const yesterday = hasDailySnapshots(yesterdayDate, true) ? dailyTotal(yesterdayDate) : null;
    const today = hasDailySnapshots(todayDate) ? dailyTotal(todayDate) : null;
    const yesterdayEstimatedTotal = yesterday
      ? yesterday.usableCount === 0 ? null : yesterday.total
      : legacyYesterday.snapshotCount === 0 ? null : legacyYesterday.total;
    const todayEstimatedTotal = today
      ? today.usableCount === 0 ? null : today.total
      : liveToday.total;
    const coverage = this.getDailySnapshotCoverage(yesterdayDate);

    return {
      yesterdayEstimatedTotal,
      todayEstimatedTotal,
      dailyIncrease:
        yesterdayEstimatedTotal === null || todayEstimatedTotal === null
          ? null
          : todayEstimatedTotal - yesterdayEstimatedTotal,
      snapshotDate: yesterdayDate,
      expectedAccountCount: coverage.expected,
      freshAccountCount: coverage.fresh,
      carriedForwardAccountCount: coverage.carriedForward,
      missingAccountCount: coverage.missing,
      isComplete: coverage.expected === 0 || coverage.missing === 0
    };
  }
}
