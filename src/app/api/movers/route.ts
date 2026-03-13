import type { NextResponse } from "next/server";

import { errorResponse, okResponse } from "@/lib/api";
import { runRouteGuards } from "@/lib/api/route-security";
import { log } from "@/lib/logger";
import { publishMarketMovers } from "@/lib/realtime/publisher";
import { AGGREGATE_SNAPSHOT_KEYS } from "@/lib/snapshots/contracts";
import { getAggregateSnapshotForRead } from "@/lib/snapshots/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADER = "public, max-age=20, s-maxage=60, stale-while-revalidate=120";
const REQUIRED_MOVER_BUCKET_SIZE = 3;

type MoversPayload = {
  movers: Array<{
    symbol: string;
    companyName: string;
    currentPrice: number | null;
    changePercent: number | null;
  }>;
};

function hasRequiredMoverBuckets(
  movers: Array<{ changePercent: number | null }>,
  perBucket = REQUIRED_MOVER_BUCKET_SIZE
): boolean {
  let winners = 0;
  let losers = 0;
  for (const mover of movers) {
    const value = mover.changePercent;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (value > 0) winners += 1;
    if (value < 0) losers += 1;
  }
  return winners >= perBucket && losers >= perBucket;
}

/**
 * Returns the cached top movers snapshot.
 *
 * The route never repairs movers inline. Incomplete buckets return warming so
 * snapshot jobs can rebuild them outside the user request path.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();
  const blocked = await runRouteGuards(request, {
    bucket: "api-movers",
    max: 120,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const snapshotRead = await getAggregateSnapshotForRead<MoversPayload>({
      key: AGGREGATE_SNAPSHOT_KEYS.MOVERS_TOP3,
      priority: "hot",
      reason: "api-movers",
      requestedBy: null
    });

    const payload = snapshotRead.snapshot?.payload ?? null;
    if (!payload || !hasRequiredMoverBuckets(payload.movers)) {
      return okResponse(
        {
          movers: [],
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

    await publishMarketMovers(payload);
    log({
      level: "info",
      service: "api-movers",
      message: "Movers snapshot served",
      state: snapshotRead.state,
      moverCount: payload.movers.length,
      durationMs: Date.now() - startedAt
    });

    return okResponse(payload, {
      headers: {
        "Cache-Control": CACHE_HEADER,
        "X-ELDAR-Data-State": snapshotRead.state + (snapshotRead.enqueued ? "+queued" : "")
      }
    });
  } catch (error) {
    return errorResponse(error, { route: "api-movers" }, { "Cache-Control": CACHE_HEADER });
  }
}
