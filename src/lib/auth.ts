import crypto from "node:crypto";

import { AuthError } from "@/lib/errors";
import { env } from "@/lib/env";

/**
 * Extracts a bearer token from the Authorization header.
 *
 * @param request - Incoming request.
 * @returns Bearer token when present, otherwise null.
 */
export function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer") {
    return null;
  }

  const normalized = (token ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Compares two secret values in constant time.
 *
 * @param left - First value.
 * @param right - Second value.
 * @returns True when both values match exactly.
 */
export function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

/**
 * Checks whether the request carries the configured cron secret in the Authorization header.
 *
 * @param request - Incoming request.
 * @returns True when the cron secret matches.
 */
export function isCronSecretValid(request: Request): boolean {
  if (env.CRON_SECRET.length === 0) {
    return false;
  }

  const token = getBearerToken(request);
  if (!token) {
    return false;
  }

  return constantTimeEqual(token, env.CRON_SECRET);
}

/**
 * Enforces bearer-based cron authorization.
 *
 * @param request - Incoming request.
 * @throws AuthError when the request is not authorized.
 */
export function verifyCronSecret(request: Request): void {
  if (!isCronSecretValid(request)) {
    throw new AuthError("Invalid cron secret");
  }
}
