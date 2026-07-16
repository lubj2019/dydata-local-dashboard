import assert from "node:assert/strict";
import test from "node:test";
import {
  FetchRequestError,
  findPlatformLoginError,
  isRetryableFetchError,
  mapWithConcurrency,
  PlatformTemporaryError,
  RequestLimiter,
  retryFetch
} from "../services/scraper.js";

test("findPlatformLoginError detects Xingtu login failures", () => {
  const message = "\u7528\u6237\u672a\u767b\u5f55[20260716155022776D3CC6F83B4BE07D02]";

  assert.equal(findPlatformLoginError({ base_resp: { status_message: message } }), message);
  assert.equal(findPlatformLoginError({ status_message: "Internal system error.[request-id]" }), null);
});

test("mapWithConcurrency caps concurrent work and preserves all results", async () => {
  let active = 0;
  let peak = 0;

  const results = await mapWithConcurrency([1, 2, 3, 4, 5], 3, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 2;
  });

  assert.equal(peak, 3);
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
});

test("mapWithConcurrency rejects when a task fails", async () => {
  const started: number[] = [];

  await assert.rejects(
    mapWithConcurrency([1, 2, 3], 1, async (value) => {
      started.push(value);
      if (value === 2) {
        throw new Error("detail request failed");
      }
      return value;
    }),
    /detail request failed/
  );

  assert.deepEqual(started, [1, 2]);
});

test("RequestLimiter caps platform requests shared by concurrent accounts", async () => {
  const limiter = new RequestLimiter(3);
  let active = 0;
  let peak = 0;

  await Promise.all(
    Array.from({ length: 9 }, () =>
      limiter.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      })
    )
  );

  assert.equal(peak, 3);
});

test("retryFetch retries rate limits with exponential backoff", async () => {
  let attempts = 0;
  let retries = 0;
  const delays: number[] = [];

  const result = await retryFetch(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new FetchRequestError(429, "https://example.test");
      }
      return "ok";
    },
    {
      wait: async (delayMs) => {
        delays.push(delayMs);
      },
      onRetry: () => {
        retries += 1;
      }
    }
  );

  assert.equal(result, "ok");
  assert.equal(retries, 2);
  assert.deepEqual(delays, [300, 600]);
});

test("retryFetch does not retry non-retryable failures", async () => {
  let attempts = 0;
  const error = new Error("invalid payload");

  await assert.rejects(
    retryFetch(async () => {
      attempts += 1;
      throw error;
    }),
    (received) => received === error
  );

  assert.equal(attempts, 1);
  assert.equal(isRetryableFetchError(new FetchRequestError(500, "https://example.test")), true);
  assert.equal(isRetryableFetchError(new FetchRequestError(400, "https://example.test")), false);
});

test("retryFetch retries temporary platform errors returned in JSON", async () => {
  let attempts = 0;
  const delays: number[] = [];

  const result = await retryFetch(
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new PlatformTemporaryError("Internal system error.[request-id]");
      }
      return "ok";
    },
    {
      wait: async (delayMs) => {
        delays.push(delayMs);
      }
    }
  );

  assert.equal(result, "ok");
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [300]);
});
