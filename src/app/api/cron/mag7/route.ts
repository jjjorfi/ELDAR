import { NextResponse } from "next/server";

import { errorResponse, okResponse } from "@/lib/api";
import { runRouteGuards } from "@/lib/api/route-security";
import { AuthError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { refreshMag7ScoresIfDue } from "@/lib/mag7";
import { verifyCronSecret } from "@/lib/auth";
import { AGGREGATE_SNAPSHOT_KEYS } from "@/lib/snapshots/contracts";
import { requestAggregateSnapshotRefresh } from "@/lib/snapshots/service";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request);
  if (blocked) return blocked;

  try {
    verifyCronSecret(request);

    const { refreshed, cards } = await refreshMag7ScoresIfDue();
    if (refreshed) {
      await Promise.all([
        requestAggregateSnapshotRefresh({
          key: AGGREGATE_SNAPSHOT_KEYS.MAG7_LIVE,
          priority: "scheduled",
          reason: "cron-mag7-refresh",
          requestedBy: null,
          payload: {}
        }),
        requestAggregateSnapshotRefresh({
          key: AGGREGATE_SNAPSHOT_KEYS.MAG7_HOME,
          priority: "scheduled",
          reason: "cron-mag7-refresh",
          requestedBy: null,
          payload: {}
        })
      ]);
    }

    log({
      level: "info",
      service: "api-cron-mag7",
      message: "MAG7 refresh evaluated",
      refreshed,
      count: cards.length
    });

    return okResponse({
      ok: true,
      refreshed,
      count: cards.length,
      updatedAt: cards[0]?.updatedAt ?? null
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error, { route: "api-cron-mag7" });
    }

    return errorResponse(error, { route: "api-cron-mag7" });
  }
}
