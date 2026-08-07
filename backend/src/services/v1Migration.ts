import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppDatabase } from "./db.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..", "..", "..");
const defaultDatabasePath = path.join(projectRoot, ".local-data", "app.db");
const migrationName = "v1_dashboard_data_model";
const requiredTables = [
  "accounts",
  "videos",
  "xingtu_tasks",
  "task_video_links",
  "task_estimate_snapshots",
  "task_play_snapshots",
  "daily_account_snapshots",
  "daily_snapshot_tasks",
  "daily_snapshot_videos",
  "daily_snapshot_links",
  "app_migrations"
];

export type PendingV1Migration = {
  backupPath: string | null;
  required: boolean;
};

function backupName(now: Date): string {
  return `app-v0.4.1-before-v1-${now.toISOString().replace(/[:.]/g, "-")}.db`;
}

function quoteSqlitePath(value: string): string {
  return value.replace(/'/g, "''");
}

export function prepareV1Migration(options: {
  databasePath?: string;
  backupDirectory?: string;
  now?: Date;
} = {}): PendingV1Migration {
  const databasePath = options.databasePath ?? defaultDatabasePath;
  if (!fs.existsSync(databasePath)) {
    return { backupPath: null, required: true };
  }

  const database = new Database(databasePath);
  try {
    const tables = new Set(
      (database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
        (table) => table.name
      )
    );
    if (tables.size === 0) {
      return { backupPath: null, required: true };
    }

    const missing = requiredTables.filter((table) => !tables.has(table));
    if (missing.length > 0) {
      throw new Error(`无法迁移旧数据库，缺少数据表：${missing.join(", ")}`);
    }

    const applied = database
      .prepare("SELECT 1 FROM app_migrations WHERE name = ?")
      .get(migrationName);
    if (applied) {
      return { backupPath: null, required: false };
    }

    const backupDirectory = options.backupDirectory ?? path.join(path.dirname(databasePath), "backups");
    fs.mkdirSync(backupDirectory, { recursive: true });
    const backupPath = path.join(backupDirectory, backupName(options.now ?? new Date()));
    database.exec(`VACUUM INTO '${quoteSqlitePath(backupPath)}'`);
    return { backupPath, required: true };
  } finally {
    database.close();
  }
}

export function completeV1Migration(database: AppDatabase) {
  database.applyV1DashboardMigration();
}
