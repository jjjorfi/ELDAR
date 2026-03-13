import type { NextResponse } from "next/server";

import { errorResponse, okResponse } from "@/lib/api";
import { runRouteGuards } from "@/lib/api/route-security";
import { log } from "@/lib/logger";
import type { MacroFredPayload } from "@/lib/macro/fred-snapshot";
import { AGGREGATE_SNAPSHOT_KEYS } from "@/lib/snapshots/contracts";
import { getAggregateSnapshotForRead } from "@/lib/snapshots/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADER = "public, max-age=300, s-maxage=600, stale-while-revalidate=1200";

/**
 * Returns the cached FRED macro snapshot used by the dashboard.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();
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
      return okResponse(
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

    log({
      level: "info",
      service: "api-macro-fred",
      message: "Macro FRED snapshot served",
      state: snapshotRead.state,
      durationMs: Date.now() - startedAt
    });

    return okResponse(payload, {
      headers: {
        "Cache-Control": CACHE_HEADER,
        "X-ELDAR-Data-State": snapshotRead.state + (snapshotRead.enqueued ? "+queued" : "")
      }
    });
  } catch (error) {
    return errorResponse(error, { route: "api-macro-fred" }, { "Cache-Control": CACHE_HEADER });
  }
}
