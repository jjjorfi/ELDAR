import { NextResponse } from "next/server";

import { runRouteGuards } from "@/lib/api/route-security";
import { getDeadSnapshotJobs } from "@/lib/snapshots/service";
import { isAuthorizedAdminRequest } from "@/lib/security/admin";

export const runtime = "nodejs";

function parseLimit(searchParams: URLSearchParams): number {
  const parsed = Number.parseInt(searchParams.get("limit") ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(500, parsed);
}

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-system-snapshot-dead-letter",
    max: 30,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseLimit(searchParams);
    const jobs = await getDeadSnapshotJobs(limit);
    return NextResponse.json({
      ok: true,
      count: jobs.length,
      jobs
    });
  } catch (error) {
    console.error("/api/system/snapshots/dead-letter GET error", error);
    return NextResponse.json({ error: "Failed to load dead-letter snapshot jobs." }, { status: 500 });
  }
}

