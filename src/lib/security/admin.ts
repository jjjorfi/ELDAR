import crypto from "node:crypto";

import { NextResponse } from "next/server";

/**
 * Compares two secrets in constant time.
 *
 * @param a First value.
 * @param b Second value.
 * @returns True when values match.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

/**
 * Extracts a bearer token from Authorization header.
 *
 * @param request Incoming request.
 * @returns Token or null.
 */
function bearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth) return null;
  const [scheme, token] = auth.split(" ", 2);
  if (scheme?.toLowerCase() !== "bearer") return null;
  const normalized = (token ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Checks whether request is authorized for privileged diagnostics.
 *
 * Uses CRON_SECRET to avoid introducing additional secret management.
 *
 * @param request Incoming request.
 * @returns True when request is authorized.
 */
export function isAuthorizedAdminRequest(request: Request): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }

  const candidate =
    bearerToken(request) ??
    request.headers.get("x-admin-secret")?.trim() ??
    request.headers.get("x-cron-secret")?.trim() ??
    "";

  if (!candidate) return false;
  return constantTimeEqual(candidate, secret);
}

/**
 * Enforces privileged access for sensitive endpoints in production.
 *
 * @param request Incoming request.
 * @returns NextResponse when blocked, otherwise null.
 */
export function requireAdminAccess(request: Request): NextResponse | null {
  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  if (isAuthorizedAdminRequest(request)) {
    return null;
  }

  return NextResponse.json(
    { error: "Not found" },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
