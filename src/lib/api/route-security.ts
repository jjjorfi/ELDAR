import type { NextResponse } from "next/server";

import guard, { isGuardBlockedError } from "@/lib/security/guard";
import { enforceRateLimit, type RateLimitConfig } from "@/lib/security/rate-limit";

/**
 * Runs shared route security gates in a single helper.
 *
 * This preserves existing security behavior while removing repeated boilerplate
 * from every API route:
 * 1. Execute `guard(request)` (admin protection + global anti-abuse checks).
 * 2. Optionally apply endpoint-scoped in-memory throttling.
 *
 * @param request Incoming request object.
 * @param rateLimit Optional endpoint-specific rate-limit config.
 * @returns Blocking `NextResponse` when denied/throttled, otherwise null.
 */
export async function runRouteGuards(
  request: Request,
  rateLimit?: RateLimitConfig
): Promise<NextResponse | null> {
  try {
    await guard(request);
  } catch (error) {
    if (isGuardBlockedError(error)) {
      return error.response;
    }
    throw error;
  }

  if (!rateLimit) {
    return null;
  }

  return enforceRateLimit(request, rateLimit);
}

