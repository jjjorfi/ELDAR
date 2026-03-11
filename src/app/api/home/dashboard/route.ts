import { NextResponse } from "next/server";

import { runRouteGuards } from "@/lib/api/route-security";
import { withApiPerfHeaders } from "@/lib/api/responses";
import { getHomeDashboardPayloadCached, parseSectorWindow } from "@/lib/home/dashboard-service";
import { isNySessionOpen } from "@/lib/market/ny-session";
import { AGGREGATE_SNAPSHOT_KEYS } from "@/lib/snapshots/contracts";
import { getAggregateSnapshotForRead } from "@/lib/snapshots/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADER_OPEN = "public, max-age=20, s-maxage=45, stale-while-revalidate=90";
const CACHE_HEADER_CLOSED = "public, max-age=90, s-maxage=240, stale-while-revalidate=480";

function aggregateDashboardKey(window: ReturnType<typeof parseSectorWindow>): string {
  if (window === "1M") return AGGREGATE_SNAPSHOT_KEYS.HOME_DASHBOARD_1M;
  if (window === "3M") return AGGREGATE_SNAPSHOT_KEYS.HOME_DASHBOARD_3M;
  if (window === "6M") return AGGREGATE_SNAPSHOT_KEYS.HOME_DASHBOARD_6M;
  return AGGREGATE_SNAPSHOT_KEYS.HOME_DASHBOARD_YTD;
}

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
    const snapshotRead = await getAggregateSnapshotForRead({
      key: aggregateDashboardKey(sectorWindow),
      priority: "hot",
      reason: "api-home-dashboard",
      requestedBy: null
    });

    let payload = snapshotRead.snapshot?.payload ?? null;
    let cacheLayer = snapshotRead.state === "fresh" ? "snapshot" : "snapshot-stale";
    if (!payload) {
      const cached = await getHomeDashboardPayloadCached(sectorWindow);
      if (cached) {
        payload = cached;
        cacheLayer = "redis-fallback";
      }
    }
    if (!payload) {
      return NextResponse.json(
        {
          pending: true,
          sectorWindow,
          refreshQueued: snapshotRead.enqueued
        },
        {
          status: 202,
          headers: withApiPerfHeaders(
            {
              "Cache-Control": "no-store"
            },
            {
              startedAt,
              cache: "warming"
            }
          )
        }
      );
    }

    const cacheHeader = isNySessionOpen() ? CACHE_HEADER_OPEN : CACHE_HEADER_CLOSED;

    return NextResponse.json(payload, {
      headers: withApiPerfHeaders(
        {
          "Cache-Control": cacheHeader,
          "X-ELDAR-Snapshot-State": snapshotRead.state
        },
        {
          startedAt,
          cache: cacheLayer + (snapshotRead.enqueued ? "+queued" : "")
        }
      )
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build dashboard payload.";
    console.error(`[API Home Dashboard]: ${message}`);
    return NextResponse.json(
      { error: "Failed to build dashboard payload." },
      {
        status: 500,
        headers: withApiPerfHeaders(
          { "Cache-Control": "no-store" },
          {
            startedAt,
            cache: "error"
          }
        )
      }
    );
  }
}
