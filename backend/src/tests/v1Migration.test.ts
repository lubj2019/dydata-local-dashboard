import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { AppDatabase } from "../services/db.js";
import { completeV1Migration, prepareV1Migration } from "../services/v1Migration.js";

test("v1 migration creates a consistent backup before recording archived statistic retention", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dydata-v1-migration-"));
  const databasePath = path.join(directory, "app.db");
  const backupDirectory = path.join(directory, "backups");
  try {
    const legacy = new AppDatabase(databasePath);
    const account = legacy.createAccount("归档账号");
    legacy.deleteAccount(account.id);
    legacy.close();

    const pending = prepareV1Migration({ databasePath, backupDirectory, now: new Date("2026-08-08T00:00:00.000Z") });
    assert.equal(pending.required, true);
    assert.ok(pending.backupPath && fs.existsSync(pending.backupPath));

    const migrated = new AppDatabase(databasePath);
    completeV1Migration(migrated);
    assert.deepEqual(migrated.listV1StatisticRetention(), [{ accountId: account.id }]);
    migrated.close();

    assert.deepEqual(prepareV1Migration({ databasePath, backupDirectory }), { backupPath: null, required: false });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("v1 migration rejects incomplete legacy schemas without creating a backup", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dydata-v1-migration-invalid-"));
  const databasePath = path.join(directory, "app.db");
  const backupDirectory = path.join(directory, "backups");
  try {
    const invalid = new Database(databasePath);
    invalid.exec("CREATE TABLE accounts (id TEXT PRIMARY KEY)");
    invalid.close();

    assert.throws(() => prepareV1Migration({ databasePath, backupDirectory }), /缺少数据表/);
    assert.equal(fs.existsSync(backupDirectory), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
