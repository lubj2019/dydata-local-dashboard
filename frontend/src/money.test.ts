import assert from "node:assert/strict";
import test from "node:test";
import { formatMoney, isVisibleMoneyChange, normalizeMoney } from "./money.js";

test("floating-point residuals are treated as zero-yuan changes", () => {
  for (const value of [7.105427357601002e-15, -5.551115123125783e-17]) {
    assert.equal(normalizeMoney(value), 0);
    assert.equal(formatMoney(value), "¥0.00");
    assert.equal(isVisibleMoneyChange(value), false);
  }
});

test("visible positive and negative money changes are retained", () => {
  assert.equal(normalizeMoney(1.236), 1.24);
  assert.equal(normalizeMoney(-0.014), -0.01);
  assert.equal(isVisibleMoneyChange(0.01), true);
  assert.equal(isVisibleMoneyChange(-0.01), true);
});
