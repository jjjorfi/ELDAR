import { NextResponse } from "next/server";

import { errorResponse, okResponse } from "@/lib/api";
import { runRouteGuards } from "@/lib/api/route-security";
import { verifyCronSecret } from "@/lib/auth";
import { AuthError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { getSnapshotOpsMetrics } from "@/lib/snapshots/service";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-system-snapshot-metrics",
    max: 60,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    verifyCronSecret(request);

    const metrics = await getSnapshotOpsMetrics();
    log({
      level: "info",
      service: "api-system-snapshot-metrics",
      message: "Snapshot metrics loaded"
    });

    return okResponse({
      ok: true,
      metrics,
      asOf: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error, { route: "api-system-snapshot-metrics" });
    }

    return errorResponse(error, { route: "api-system-snapshot-metrics" });
  }
}
