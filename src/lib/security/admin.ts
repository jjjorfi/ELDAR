import { NextResponse } from "next/server";

import { constantTimeEqual, getBearerToken } from "@/lib/auth";
import { env } from "@/lib/env";

/**
 * Checks whether request is authorized for privileged diagnostics.
 *
 * Uses CRON_SECRET to avoid introducing additional secret management.
 *
 * @param request Incoming request.
 * @returns True when request is authorized.
 */
export function isAuthorizedAdminRequest(request: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) {
    return env.NODE_ENV !== "production";
  }

  const candidate =
    getBearerToken(request) ??
    request.headers.get("x-admin-secret")?.trim() ??
    request.headers.get("x-cron-secret")?.trim() ??
    "";

  if (!candidate) return false;
  return constantTimeEqual(candidate, secret);
}

/**
 * Checks whether request is authorized for cron-triggered operational work.
 *
 * Deliberately does not trust provider-specific marker headers on their own.
 * A valid shared secret is required so external callers cannot spoof cron
 * execution by replaying header names such as `x-vercel-cron`.
 *
 * @param request Incoming request.
 * @returns True when cron/admin secret is valid.
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  return isAuthorizedAdminRequest(request);
}

/**
 * Enforces privileged access for sensitive endpoints in production.
 *
 * @param request Incoming request.
 * @returns NextResponse when blocked, otherwise null.
 */
export function requireAdminAccess(request: Request): NextResponse | null {
  if (env.NODE_ENV !== "production") {
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
