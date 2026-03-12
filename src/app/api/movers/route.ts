import { NextResponse } from "next/server";

import { runRouteGuards } from "@/lib/api/route-security";
import { fetchTopSp500Movers } from "@/lib/home/sp500-movers";
import { publishMarketMovers } from "@/lib/realtime/publisher";
import { AGGREGATE_SNAPSHOT_KEYS } from "@/lib/snapshots/contracts";
import { getAggregateSnapshotForRead } from "@/lib/snapshots/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADER = "public, max-age=20, s-maxage=60, stale-while-revalidate=120";
const REQUIRED_MOVER_BUCKET_SIZE = 3;

interface MoversPayload {
  movers: Array<{
    symbol: string;
    companyName: string;
    currentPrice: number | null;
    changePercent: number | null;
  }>;
}

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

export async function GET(request: Request): Promise<NextResponse> {
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
    if (!payload) {
      return NextResponse.json(
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

    let resolvedPayload = payload;
    if (!hasRequiredMoverBuckets(payload.movers)) {
      const rebuilt = await fetchTopSp500Movers(REQUIRED_MOVER_BUCKET_SIZE);
      resolvedPayload = { movers: rebuilt };
    }
    if (!hasRequiredMoverBuckets(resolvedPayload.movers)) {
      return NextResponse.json(
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

    const stateHeader = snapshotRead.state + (snapshotRead.enqueued ? "+queued" : "");
    await publishMarketMovers(resolvedPayload);
    return NextResponse.json(resolvedPayload, {
      headers: {
        "Cache-Control": CACHE_HEADER,
        "X-ELDAR-Data-State": stateHeader
      }
    });
  } catch (error) {
    console.error("/api/movers GET error", error);
    return NextResponse.json(
      { movers: [] },
      {
        status: 200,
        headers: {
          "Cache-Control": CACHE_HEADER,
          "X-ELDAR-Data-State": "degraded"
        }
      }
    );
  }
}
