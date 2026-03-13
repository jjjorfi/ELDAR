import type { NextResponse } from "next/server";

import { errorResponse, okResponse } from "@/lib/api";
import { runRouteGuards } from "@/lib/api/route-security";
import { resolveHomeDashboardPayload } from "@/lib/home/dashboard-read";
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
    const homeDashboard = await resolveHomeDashboardPayload("YTD");
    const alignedMacroRegime = homeDashboard.payload?.regime ?? payload?.macroRegime ?? null;

    if (!payload) {
      return okResponse(
        {
          indicators: [],
          fetchedAt: null,
          macroRegime: alignedMacroRegime,
          pending: true,
          refreshQueued: snapshotRead.enqueued || homeDashboard.enqueued
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

    const responsePayload: MacroFredPayload = {
      ...payload,
      macroRegime: alignedMacroRegime
    };

    log({
      level: "info",
      service: "api-macro-fred",
      message: "Macro FRED snapshot served",
      state: snapshotRead.state,
      dashboardState: homeDashboard.snapshotState,
      durationMs: Date.now() - startedAt
    });

    return okResponse(responsePayload, {
      headers: {
        "Cache-Control": CACHE_HEADER,
        "X-ELDAR-Data-State": snapshotRead.state + (snapshotRead.enqueued ? "+queued" : "")
      }
    });
  } catch (error) {
    return errorResponse(error, { route: "api-macro-fred" }, { "Cache-Control": CACHE_HEADER });
  }
}
