import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { getRecentAnalyses } from "@/lib/storage";
import guard, { isGuardBlockedError } from "@/lib/security/guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    // Shared security gate: protected-route policy + global rolling per-IP limit.
    await guard(request);
  } catch (error) {
    if (isGuardBlockedError(error)) {
      return error.response;
    }
    throw error;
  }

  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const throttled = enforceRateLimit(request, {
      bucket: "api-history",
      max: 120,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    const url = new URL(request.url);
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20;

    const analyses = await getRecentAnalyses(safeLimit, userId);
    return NextResponse.json({ analyses }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("/api/history error", error);
    return NextResponse.json({ error: "Failed to load history." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
