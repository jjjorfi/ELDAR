import { NextResponse } from "next/server";

import { runRouteGuards } from "@/lib/api/route-security";
import { getSnapshotOpsMetrics } from "@/lib/snapshots/service";
import { isAuthorizedAdminRequest } from "@/lib/security/admin";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-system-snapshot-metrics",
    max: 60,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const metrics = await getSnapshotOpsMetrics();
    return NextResponse.json({
      ok: true,
      metrics,
      asOf: new Date().toISOString()
    });
  } catch (error) {
    console.error("/api/system/snapshots/metrics GET error", error);
    return NextResponse.json({ error: "Failed to load snapshot metrics." }, { status: 500 });
  }
}

