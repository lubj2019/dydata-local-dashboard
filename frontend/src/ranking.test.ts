import assert from "node:assert/strict";
import test from "node:test";
import { getTaskEstimatedDelta } from "./ranking.js";

test("new tasks use zero as the previous-day estimate", () => {
  assert.equal(getTaskEstimatedDelta(13.05, null, false), 13.05);
});

test("existing tasks compare their current and previous-day estimates", () => {
  assert.equal(getTaskEstimatedDelta(15, 12.5, true), 2.5);
});
