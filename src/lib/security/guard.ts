import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/security/admin";

const GLOBAL_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_RPM = 60;
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const RATE_LIMIT_STATE = new Map<string, number[]>();
let nextCleanupAtMs = 0;

/**
 * Error thrown when the shared guard blocks a request.
 * Route handlers can catch this and return the embedded response.
 */
export class GuardBlockedError extends Error {
  response: NextResponse;

  constructor(response: NextResponse) {
    super("Request blocked by security guard.");
    this.name = "GuardBlockedError";
    this.response = response;
  }
}

/**
 * Type guard helper so route handlers can safely branch on guard failures.
 */
export function isGuardBlockedError(error: unknown): error is GuardBlockedError {
  return error instanceof GuardBlockedError;
}

/**
 * Reads RPM config from env with a safe default.
 */
function readRateLimitRpm(): number {
  const parsed = Number.parseInt((process.env.RATE_LIMIT_RPM ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RATE_LIMIT_RPM;
  }
  return parsed;
}

/**
 * Reads request body-size ceiling from env with a safe default.
 */
function readMaxBodyBytes(): number {
  const parsed = Number.parseInt((process.env.MAX_BODY_BYTES ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_BODY_BYTES;
  }
  return parsed;
}

/**
 * Extracts a single token from comma-delimited forwarding headers.
 */
function firstHeaderToken(value: string | null): string | null {
  if (!value) return null;
  const token = value.split(",")[0]?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * Returns the best-effort client identifier for rate limiting.
 * BOT_WAF_HEADER takes priority so trusted edge IP headers can override spoofable ones.
 */
function clientIdentifier(request: Request): string {
  const botWafHeader = (process.env.BOT_WAF_HEADER ?? "").trim();
  if (botWafHeader.length > 0) {
    const wafValue = firstHeaderToken(request.headers.get(botWafHeader));
    if (wafValue) {
      return wafValue.slice(0, 120);
    }
  }

  const forwarded = firstHeaderToken(request.headers.get("x-forwarded-for"));
  const realIp = firstHeaderToken(request.headers.get("x-real-ip"));
  return (forwarded ?? realIp ?? "unknown").slice(0, 120);
}

/**
 * Identifies production-only admin routes to prevent accidental public exposure.
 */
function isProtectedPath(pathname: string): boolean {
  return (
    pathname === "/api/health" ||
    pathname === "/api/health/" ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/api/debug-") ||
    pathname.startsWith("/api/test-")
  );
}

/**
 * Cleans up stale limiter entries to keep memory bounded.
 */
function pruneLimiterState(nowMs: number): void {
  if (nowMs < nextCleanupAtMs && RATE_LIMIT_STATE.size < 5000) {
    return;
  }

  const cutoff = nowMs - GLOBAL_WINDOW_MS;
  for (const [key, hits] of RATE_LIMIT_STATE.entries()) {
    const freshHits = hits.filter((timestampMs) => timestampMs > cutoff);
    if (freshHits.length === 0) {
      RATE_LIMIT_STATE.delete(key);
      continue;
    }
    RATE_LIMIT_STATE.set(key, freshHits);
  }

  nextCleanupAtMs = nowMs + 60_000;
}

/**
 * Applies a global rolling per-IP RPM ceiling.
 */
function enforceGlobalRateLimit(request: Request): NextResponse | null {
  const nowMs = Date.now();
  pruneLimiterState(nowMs);

  const key = clientIdentifier(request);
  const current = RATE_LIMIT_STATE.get(key) ?? [];
  const cutoff = nowMs - GLOBAL_WINDOW_MS;
  const freshHits = current.filter((timestampMs) => timestampMs > cutoff);
  const maxPerMinute = readRateLimitRpm();

  if (freshHits.length >= maxPerMinute) {
    const oldestWindowHit = freshHits[0] ?? nowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestWindowHit + GLOBAL_WINDOW_MS - nowMs) / 1000));

    return NextResponse.json(
      { error: "Too many requests. Please retry shortly." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSeconds),
          "Cache-Control": "no-store"
        }
      }
    );
  }

  freshHits.push(nowMs);
  RATE_LIMIT_STATE.set(key, freshHits);
  return null;
}

/**
 * Enforces a small body-size ceiling to reduce trivial request-body DoS.
 */
function enforceBodySizeLimit(request: Request): NextResponse | null {
  if (!["POST", "PUT", "PATCH"].includes(request.method.toUpperCase())) {
    return null;
  }

  const rawLength = request.headers.get("content-length");
  if (!rawLength) {
    return null;
  }

  const length = Number.parseInt(rawLength, 10);
  if (!Number.isFinite(length) || length <= 0) {
    return null;
  }

  const maxBodyBytes = readMaxBodyBytes();
  if (length > maxBodyBytes) {
    return NextResponse.json(
      { error: "Request entity too large." },
      {
        status: 413,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }

  return null;
}

/**
 * Shared, opt-in security gate for API handlers.
 *
 * - Protects sensitive operational routes in production unless admin access is present.
 * - Applies a global rolling 60s per-IP ceiling (configurable via RATE_LIMIT_RPM).
 * - Rejects oversized write requests (configurable via MAX_BODY_BYTES).
 */
export default async function guard(
  request: Request,
  // These optional args keep compatibility with middleware-like signatures.
  _response?: unknown,
  next?: () => unknown | Promise<unknown>
): Promise<void> {
  const pathname = new URL(request.url).pathname;

  if (isProtectedPath(pathname)) {
    const blocked = requireAdminAccess(request);
    if (blocked) {
      throw new GuardBlockedError(blocked);
    }
  }

  const throttled = enforceGlobalRateLimit(request);
  if (throttled) {
    throw new GuardBlockedError(throttled);
  }

  const oversized = enforceBodySizeLimit(request);
  if (oversized) {
    throw new GuardBlockedError(oversized);
  }

  if (typeof next === "function") {
    await next();
  }
}
