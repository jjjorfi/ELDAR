import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import guard, { isGuardBlockedError } from "@/lib/security/guard";

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  CRON_SECRET: process.env.CRON_SECRET,
  RATE_LIMIT_RPM: process.env.RATE_LIMIT_RPM,
  BOT_WAF_HEADER: process.env.BOT_WAF_HEADER,
  MAX_BODY_BYTES: process.env.MAX_BODY_BYTES
};

function restoreEnv(): void {
  process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  process.env.CRON_SECRET = ORIGINAL_ENV.CRON_SECRET;
  process.env.RATE_LIMIT_RPM = ORIGINAL_ENV.RATE_LIMIT_RPM;
  process.env.BOT_WAF_HEADER = ORIGINAL_ENV.BOT_WAF_HEADER;
  process.env.MAX_BODY_BYTES = ORIGINAL_ENV.MAX_BODY_BYTES;
}

function request(pathname: string, headers: Record<string, string> = {}, method = "GET"): Request {
  return new Request(`https://eldar.local${pathname}`, {
    method,
    headers
  });
}

afterEach(() => {
  restoreEnv();
});

test("guard blocks protected health route in production without admin token", async () => {
  process.env.NODE_ENV = "production";
  process.env.CRON_SECRET = "unit-test-cron-secret";
  process.env.RATE_LIMIT_RPM = "1000";

  await assert.rejects(
    () => guard(request("/api/health")),
    (error: unknown) =>
      isGuardBlockedError(error) &&
      error.response.status === 404 &&
      error.response.headers.get("cache-control") === "no-store"
  );
});

test("guard allows protected route in production when admin token is valid", async () => {
  process.env.NODE_ENV = "production";
  process.env.CRON_SECRET = "unit-test-cron-secret";
  process.env.RATE_LIMIT_RPM = "1000";

  await assert.doesNotReject(() =>
    guard(
      request("/api/health", {
        authorization: "Bearer unit-test-cron-secret"
      })
    )
  );
});

test("guard enforces rolling per-IP limit using BOT_WAF_HEADER over spoofable headers", async () => {
  process.env.NODE_ENV = "development";
  process.env.CRON_SECRET = "";
  process.env.RATE_LIMIT_RPM = "2";
  process.env.BOT_WAF_HEADER = "CF-Connecting-IP";

  const trustedIp = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;

  await assert.doesNotReject(() =>
    guard(
      request("/api/search", {
        "CF-Connecting-IP": trustedIp,
        "x-forwarded-for": "1.1.1.1"
      })
    )
  );

  await assert.doesNotReject(() =>
    guard(
      request("/api/search", {
        "CF-Connecting-IP": trustedIp,
        "x-forwarded-for": "2.2.2.2"
      })
    )
  );

  await assert.rejects(
    () =>
      guard(
        request("/api/search", {
          "CF-Connecting-IP": trustedIp,
          "x-forwarded-for": "3.3.3.3"
        })
      ),
    (error: unknown) => isGuardBlockedError(error) && error.response.status === 429
  );
});

test("guard blocks oversized write requests when MAX_BODY_BYTES is exceeded", async () => {
  process.env.NODE_ENV = "development";
  process.env.RATE_LIMIT_RPM = "1000";
  process.env.MAX_BODY_BYTES = "16";

  await assert.rejects(
    () =>
      guard(
        request(
          "/api/rate",
          {
            "content-length": "1024"
          },
          "POST"
        )
      ),
    (error: unknown) => isGuardBlockedError(error) && error.response.status === 413
  );
});
