import { NextResponse } from "next/server";

import { runRouteGuards } from "@/lib/api/route-security";
import { publishMarketMovers } from "@/lib/realtime/publisher";
import { AGGREGATE_SNAPSHOT_KEYS } from "@/lib/snapshots/contracts";
import { getAggregateSnapshotForRead } from "@/lib/snapshots/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADER = "public, max-age=20, s-maxage=60, stale-while-revalidate=120";

interface MoversPayload {
  movers: Array<{
    symbol: string;
    companyName: string;
    currentPrice: number | null;
    changePercent: number | null;
  }>;
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

    const stateHeader = snapshotRead.state + (snapshotRead.enqueued ? "+queued" : "");
    await publishMarketMovers(payload);
    return NextResponse.json(payload, {
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
