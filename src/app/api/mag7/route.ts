import type { NextResponse } from "next/server";

import { errorResponse, okResponse } from "@/lib/api";
import { runRouteGuards } from "@/lib/api/route-security";
import { log } from "@/lib/logger";
import { resolveMag7Payload } from "@/lib/mag7-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADER_LIVE_OPEN = "public, max-age=10, s-maxage=20, stale-while-revalidate=40";
const CACHE_HEADER_LIVE_CLOSED = "public, max-age=60, s-maxage=120, stale-while-revalidate=240";
const CACHE_HEADER_HOME = "public, max-age=20, s-maxage=30, stale-while-revalidate=60";

/**
 * Returns MAG7 cards for either the live monitor or the cached homepage strip.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();
  const blocked = await runRouteGuards(request, {
    bucket: "api-mag7",
    max: 120,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const url = new URL(request.url);
    const isLive = url.searchParams.get("live") === "1";
    const resolved = await resolveMag7Payload(isLive ? "live" : "home");
    if (!resolved.payload) {
      return okResponse(
        {
          pending: true,
          refreshQueued: resolved.enqueued,
          live: isLive
        },
        {
          status: 202,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    const { cards, marketOpen } = resolved.payload;
    log({
      level: "info",
      service: "api-mag7",
      message: isLive ? "MAG7 live cards served" : "MAG7 homepage cards served",
      marketOpen,
      cacheLayer: resolved.cacheLayer,
      snapshotState: resolved.snapshotState,
      durationMs: Date.now() - startedAt
    });

    return okResponse(
      { cards, marketOpen },
      {
        headers: {
          "Cache-Control":
            isLive
              ? marketOpen
                ? CACHE_HEADER_LIVE_OPEN
                : CACHE_HEADER_LIVE_CLOSED
              : CACHE_HEADER_HOME,
          "X-ELDAR-Snapshot-State": resolved.snapshotState
        }
      }
    );
  } catch (error) {
    return errorResponse(error, { route: "api-mag7" }, { "Cache-Control": "no-store" });
  }
}
