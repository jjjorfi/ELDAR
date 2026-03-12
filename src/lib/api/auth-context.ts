// This file provides a minimal auth context helper for API routes.
// It wraps Clerk's `auth()` so route handlers can require authenticated users
// without repeating null checks and `orgId ?? null` normalization.
//
// Connected files:
// - src/app/api/watchlist/route.ts
// - src/app/api/portfolio/route.ts
// - src/app/api/history/route.ts
// - src/app/api/journal/**/route.ts
//
// Gotchas for future agents:
// - Returns `null` when no authenticated user exists; callers must convert that
//   into a 401 response.
// - `orgId` is normalized to `null` for consistent downstream payloads.

import { auth } from "@clerk/nextjs/server";

export interface ApiAuthContext {
  userId: string;
  orgId: string | null;
}

export async function getApiAuthContext(): Promise<ApiAuthContext | null> {
  const { userId, orgId } = await auth();
  if (!userId) {
    return null;
  }
  return {
    userId,
    orgId: orgId ?? null
  };
}
