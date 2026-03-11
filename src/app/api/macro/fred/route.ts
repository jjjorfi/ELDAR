import { NextResponse } from "next/server";

import { runRouteGuards } from "@/lib/api/route-security";
import type { MacroFredPayload } from "@/lib/macro/fred-snapshot";
import { AGGREGATE_SNAPSHOT_KEYS } from "@/lib/snapshots/contracts";
import { getAggregateSnapshotForRead } from "@/lib/snapshots/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADER = "public, max-age=300, s-maxage=600, stale-while-revalidate=1200";

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-macro-fred",
    max: 90,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const snapshotRead = await getAggregateSnapshotForRead<MacroFredPayload>({
      key: AGGREGATE_SNAPSHOT_KEYS.MACRO_FRED,
      priority: "scheduled",
      reason: "api-macro-fred",
      requestedBy: null
    });

    const payload = snapshotRead.snapshot?.payload ?? null;
    if (!payload) {
      return NextResponse.json(
        {
          indicators: [],
          fetchedAt: null,
          macroRegime: null,
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

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": CACHE_HEADER,
        "X-ELDAR-Data-State": snapshotRead.state + (snapshotRead.enqueued ? "+queued" : "")
      }
    });
  } catch (error) {
    console.error("/api/macro/fred GET error", error);
    return NextResponse.json(
      {
        indicators: [],
        fetchedAt: null,
        macroRegime: null,
        stale: true
      },
      {
        status: 503,
        headers: {
          "Cache-Control": CACHE_HEADER,
          "X-ELDAR-Data-State": "degraded"
        }
      }
    );
  }
}
