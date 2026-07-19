import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { AppDatabase } from "../services/db.js";

test("legacy expired accounts are queued for session recheck exactly once", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dydata-account-status-"));
  const databasePath = path.join(directory, "app.db");

  try {
    const legacyDatabase = new Database(databasePath);
    legacyDatabase.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        platform TEXT NOT NULL,
        session_dir TEXT NOT NULL,
        login_status TEXT NOT NULL,
        last_sync_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL
      )
    `);
    legacyDatabase
      .prepare(`
        INSERT INTO accounts (id, display_name, platform, session_dir, login_status, last_sync_at, last_error, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run("legacy-account", "legacy", "douyin", directory, "expired", null, "network error", "2026-07-19T00:00:00.000Z");
    legacyDatabase.close();

    const migrated = new AppDatabase(databasePath);
    assert.equal(migrated.getAccount("legacy-account")?.loginStatus, "session_recheck_pending");
    migrated.updateAccountStatus("legacy-account", { loginStatus: "expired" });
    migrated.close();

    const reopened = new AppDatabase(databasePath);
    assert.equal(reopened.getAccount("legacy-account")?.loginStatus, "expired");
    reopened.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
