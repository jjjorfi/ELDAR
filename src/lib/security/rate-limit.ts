import { NextResponse } from "next/server";

interface RateLimitEntry {
  count: number;
  resetAtMs: number;
}

export interface RateLimitConfig {
  bucket: string;
  max: number;
  windowMs: number;
}

const RATE_LIMIT_STATE = new Map<string, RateLimitEntry>();
let nextCleanupAtMs = 0;

/**
 * Extracts first token from a comma-delimited forwarding header.
 *
 * @param value Header value.
 * @returns First non-empty token or null.
 */
function firstHeaderToken(value: string | null): string | null {
  if (!value) return null;
  const token = value.split(",")[0]?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * Extracts a best-effort client identifier from request headers.
 *
 * Honors BOT_WAF_HEADER first so operators can pin rate limiting to a trusted
 * edge header (for example CF-Connecting-IP) instead of spoofable client input.
 *
 * @param request Incoming request.
 * @returns Stable request key segment.
 */
function clientKey(request: Request): string {
  const trustedHeaderName = (process.env.BOT_WAF_HEADER ?? "").trim();
  if (trustedHeaderName.length > 0) {
    const trustedValue = firstHeaderToken(request.headers.get(trustedHeaderName));
    return (trustedValue ?? "unknown").slice(0, 120);
  }

  const realIp = firstHeaderToken(request.headers.get("x-real-ip"));
  const forwarded = firstHeaderToken(request.headers.get("x-forwarded-for"));
  const ip = realIp ?? forwarded ?? "unknown";
  return ip.slice(0, 120);
}

/**
 * Prunes expired buckets to keep memory bounded.
 *
 * @param now Current epoch ms.
 */
function prune(now: number): void {
  if (now < nextCleanupAtMs && RATE_LIMIT_STATE.size < 5000) {
    return;
  }

  for (const [key, value] of RATE_LIMIT_STATE.entries()) {
    if (value.resetAtMs <= now) {
      RATE_LIMIT_STATE.delete(key);
    }
  }

  nextCleanupAtMs = now + 60_000;
}

/**
 * Applies a lightweight in-memory rate limit.
 *
 * @param request Incoming request.
 * @param config Rate-limit config.
 * @returns Blocking response when limit exceeded, otherwise null.
 */
export function enforceRateLimit(request: Request, config: RateLimitConfig): NextResponse | null {
  const now = Date.now();
  prune(now);

  const key = `${config.bucket}:${clientKey(request)}`;
  const existing = RATE_LIMIT_STATE.get(key);

  if (!existing || existing.resetAtMs <= now) {
    RATE_LIMIT_STATE.set(key, { count: 1, resetAtMs: now + config.windowMs });
    return null;
  }

  if (existing.count >= config.max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAtMs - now) / 1000));
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

  existing.count += 1;
  RATE_LIMIT_STATE.set(key, existing);
  return null;
}
