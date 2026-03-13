import { NextResponse } from "next/server";

import { errorResponse, okResponse } from "@/lib/api";
import { runRouteGuards } from "@/lib/api/route-security";
import { verifyCronSecret } from "@/lib/auth";
import { AuthError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { getDeadSnapshotJobs } from "@/lib/snapshots/service";

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

  try {
    verifyCronSecret(request);

    const { searchParams } = new URL(request.url);
    const limit = parseLimit(searchParams);
    const jobs = await getDeadSnapshotJobs(limit);
    log({
      level: "info",
      service: "api-system-snapshot-dead-letter",
      message: "Dead-letter snapshot jobs loaded",
      count: jobs.length,
      limit
    });

    return okResponse({
      ok: true,
      count: jobs.length,
      jobs
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error, { route: "api-system-snapshot-dead-letter" });
    }

    return errorResponse(error, { route: "api-system-snapshot-dead-letter" });
  }
}
