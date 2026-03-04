import { NextResponse } from "next/server";

import { getHomepageMag7Scores, getMag7LiveScores } from "@/lib/mag7";
import { publishMag7 } from "@/lib/realtime/publisher";
import guard, { isGuardBlockedError } from "@/lib/security/guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CACHE_HEADER_LIVE_OPEN = "public, max-age=10, s-maxage=20, stale-while-revalidate=40";
const CACHE_HEADER_LIVE_CLOSED = "public, max-age=60, s-maxage=120, stale-while-revalidate=240";
const CACHE_HEADER_HOME = "public, max-age=20, s-maxage=30, stale-while-revalidate=60";

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
    const throttled = enforceRateLimit(request, {
      bucket: "api-mag7",
      max: 120,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    const url = new URL(request.url);
    const isLive = url.searchParams.get("live") === "1";

    if (isLive) {
      const { cards, marketOpen } = await getMag7LiveScores();
      await publishMag7({ cards, marketOpen });
      return NextResponse.json(
        { cards, marketOpen },
        { headers: { "Cache-Control": marketOpen ? CACHE_HEADER_LIVE_OPEN : CACHE_HEADER_LIVE_CLOSED } }
      );
    }

    const cards = await getHomepageMag7Scores();
    return NextResponse.json({ cards, marketOpen: null }, { headers: { "Cache-Control": CACHE_HEADER_HOME } });
  } catch (error) {
    console.error("/api/mag7 GET error", error);
    return NextResponse.json({ error: "Failed to load MAG 7 scores." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
