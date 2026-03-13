import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { isAuthorizedCronRequest } from "@/lib/security/admin";
import guard, { isGuardBlockedError } from "@/lib/security/guard";

const ENV = process.env as Record<string, string | undefined>;

const ORIGINAL_ENV = {
  NODE_ENV: ENV.NODE_ENV,
  CRON_SECRET: ENV.CRON_SECRET,
  RATE_LIMIT_RPM: ENV.RATE_LIMIT_RPM,
  BOT_WAF_HEADER: ENV.BOT_WAF_HEADER,
  MAX_BODY_BYTES: ENV.MAX_BODY_BYTES
};

function restoreEnv(): void {
  ENV.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  ENV.CRON_SECRET = ORIGINAL_ENV.CRON_SECRET;
  ENV.RATE_LIMIT_RPM = ORIGINAL_ENV.RATE_LIMIT_RPM;
  ENV.BOT_WAF_HEADER = ORIGINAL_ENV.BOT_WAF_HEADER;
  ENV.MAX_BODY_BYTES = ORIGINAL_ENV.MAX_BODY_BYTES;
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
  ENV.NODE_ENV = "production";
  ENV.CRON_SECRET = "unit-test-cron-secret";
  ENV.RATE_LIMIT_RPM = "1000";

  await assert.rejects(
    () => guard(request("/api/health")),
    (error: unknown) =>
      isGuardBlockedError(error) &&
      error.response.status === 404 &&
      error.response.headers.get("cache-control") === "no-store"
  );
});

test("guard blocks protected system route in production without admin token", async () => {
  ENV.NODE_ENV = "production";
  ENV.CRON_SECRET = "unit-test-cron-secret";
  ENV.RATE_LIMIT_RPM = "1000";

  await assert.rejects(
    () => guard(request("/api/system/cache")),
    (error: unknown) =>
      isGuardBlockedError(error) &&
      error.response.status === 404 &&
      error.response.headers.get("cache-control") === "no-store"
  );
});

test("guard allows protected route in production when admin token is valid", async () => {
  ENV.NODE_ENV = "production";
  ENV.CRON_SECRET = "unit-test-cron-secret";
  ENV.RATE_LIMIT_RPM = "1000";

  await assert.doesNotReject(() =>
    guard(
      request("/api/health", {
        authorization: "Bearer unit-test-cron-secret"
      })
    )
  );
});

test("guard enforces rolling per-IP limit using BOT_WAF_HEADER over spoofable headers", async () => {
  ENV.NODE_ENV = "development";
  ENV.CRON_SECRET = "";
  ENV.RATE_LIMIT_RPM = "2";
  ENV.BOT_WAF_HEADER = "CF-Connecting-IP";

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
  ENV.NODE_ENV = "development";
  ENV.RATE_LIMIT_RPM = "1000";
  ENV.MAX_BODY_BYTES = "16";

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

test("cron authorization rejects spoofed x-vercel-cron header without shared secret", () => {
  ENV.NODE_ENV = "production";
  ENV.CRON_SECRET = "unit-test-cron-secret";

  assert.equal(
    isAuthorizedCronRequest(
      request("/api/cron/mag7", {
        "x-vercel-cron": "1"
      })
    ),
    false
  );
});
