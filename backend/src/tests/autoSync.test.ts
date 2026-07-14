import assert from "node:assert/strict";
import test from "node:test";
import { computeNextDailyCutoff, computeNextDailyRetry, isAutoSyncEligibleAccount } from "../services/autoSync.js";

test("isAutoSyncEligibleAccount skips accounts that have not completed login", () => {
  assert.equal(isAutoSyncEligibleAccount({ loginStatus: "never_logged_in" }), false);
  assert.equal(isAutoSyncEligibleAccount({ loginStatus: "waiting_scan" }), false);
  assert.equal(isAutoSyncEligibleAccount({ loginStatus: "active" }), true);
  assert.equal(isAutoSyncEligibleAccount({ loginStatus: "expired" }), true);
});

test("computeNextDailyCutoff returns same-day 23:30 before cutoff", () => {
  const next = computeNextDailyCutoff(new Date("2026-07-11T10:30:00+08:00"));
  assert.equal(next.toISOString(), "2026-07-11T15:30:00.000Z");
});

test("computeNextDailyCutoff rolls over after cutoff", () => {
  const next = computeNextDailyCutoff(new Date("2026-07-11T23:31:00+08:00"));
  assert.equal(next.toISOString(), "2026-07-12T15:30:00.000Z");
});

test("computeNextDailyRetry returns same-day 23:50 before retry slot", () => {
  const next = computeNextDailyRetry(new Date("2026-07-11T10:30:00+08:00"));
  assert.equal(next.toISOString(), "2026-07-11T15:50:00.000Z");
});

test("computeNextDailyRetry rolls over after retry slot", () => {
  const next = computeNextDailyRetry(new Date("2026-07-11T23:51:00+08:00"));
  assert.equal(next.toISOString(), "2026-07-12T15:50:00.000Z");
});
