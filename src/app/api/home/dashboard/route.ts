import { NextResponse } from "next/server";

import { errorResponse, okResponse } from "@/lib/api";
import { runRouteGuards } from "@/lib/api/route-security";
import { withApiPerfHeaders } from "@/lib/api/responses";
import { resolveHomeDashboardPayload } from "@/lib/home/dashboard-read";
import { parseSectorWindow } from "@/lib/home/dashboard-service";
import { log } from "@/lib/logger";
import { isNySessionOpen } from "@/lib/market/ny-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADER_OPEN = "public, max-age=20, s-maxage=45, stale-while-revalidate=90";
const CACHE_HEADER_CLOSED = "public, max-age=90, s-maxage=240, stale-while-revalidate=480";

export async function GET(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();
  const blocked = await runRouteGuards(request, {
    bucket: "api-home-dashboard",
    max: 90,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const url = new URL(request.url);
    const sectorWindow = parseSectorWindow(url.searchParams.get("sectorWindow"));
    const resolved = await resolveHomeDashboardPayload(sectorWindow);
    const payload = resolved.payload;
    if (!payload) {
      return okResponse(
        {
          pending: true,
          sectorWindow,
          refreshQueued: resolved.enqueued
        },
        {
          status: 202,
          headers: withApiPerfHeaders(
            {
              "Cache-Control": "no-store"
            },
            {
              startedAt,
              cache: resolved.cacheLayer
            }
          )
        }
      );
    }

    const cacheHeader = isNySessionOpen() ? CACHE_HEADER_OPEN : CACHE_HEADER_CLOSED;
    log({
      level: "info",
      service: "api-home-dashboard",
      message: "Home dashboard resolved",
      sectorWindow,
      cacheLayer: resolved.cacheLayer,
      snapshotState: resolved.snapshotState,
      durationMs: Date.now() - startedAt
    });

    return okResponse(payload, {
      headers: withApiPerfHeaders(
        {
          "Cache-Control": cacheHeader,
          "X-ELDAR-Snapshot-State": resolved.snapshotState
        },
        {
          startedAt,
          cache: resolved.cacheLayer + (resolved.enqueued ? "+queued" : "")
        }
      )
    });
  } catch (error) {
    return errorResponse(
      error,
      { route: "api-home-dashboard" },
      withApiPerfHeaders(
        { "Cache-Control": "no-store" },
        {
          startedAt,
          cache: "error"
        }
      )
    );
  }
}
