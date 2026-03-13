import type { NextResponse } from "next/server";

import { errorResponse, okResponse } from "@/lib/api";
import { runRouteGuards } from "@/lib/api/route-security";
import { EARNINGS_CACHE_HEADER, type EarningsPayload } from "@/lib/features/earnings/service";
import { log } from "@/lib/logger";
import { AGGREGATE_SNAPSHOT_KEYS } from "@/lib/snapshots/contracts";
import { getAggregateSnapshotForRead } from "@/lib/snapshots/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the cached earnings snapshot for the homepage surfaces.
 *
 * User-facing requests remain snapshot-only. If the aggregate is missing or stale,
 * the snapshot worker is queued and the route returns a warming payload instead of
 * rebuilding provider data inline.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();
  const blocked = await runRouteGuards(request, {
    bucket: "api-earnings",
    max: 90,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const snapshotRead = await getAggregateSnapshotForRead<EarningsPayload>({
      key: AGGREGATE_SNAPSHOT_KEYS.EARNINGS,
      priority: "scheduled",
      reason: "api-earnings",
      requestedBy: null
    });

    const payload = snapshotRead.snapshot?.payload ?? null;
    if (!payload) {
      return okResponse(
        {
          upcoming: [],
          passed: [],
          pending: true,
          refreshQueued: snapshotRead.enqueued
        },
        {
          status: 202,
          headers: {
            "Cache-Control": "no-store",
            "X-ELDAR-Data-State": "warming"
          }
        }
      );
    }

    log({
      level: "info",
      service: "api-earnings",
      message: "Earnings snapshot served",
      state: snapshotRead.state,
      durationMs: Date.now() - startedAt
    });

    return okResponse(payload, {
      headers: {
        "Cache-Control": EARNINGS_CACHE_HEADER,
        "X-ELDAR-Data-State": snapshotRead.state + (snapshotRead.enqueued ? "+queued" : "")
      }
    });
  } catch (error) {
    return errorResponse(error, { route: "api-earnings" }, { "Cache-Control": "no-store" });
  }
}
