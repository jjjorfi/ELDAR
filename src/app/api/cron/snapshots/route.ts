import { NextResponse } from "next/server";

import { errorResponse, okResponse } from "@/lib/api";
import { runRouteGuards } from "@/lib/api/route-security";
import { AuthError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { processSnapshotJobs } from "@/lib/snapshots/service";
import { verifyCronSecret } from "@/lib/auth";

export const runtime = "nodejs";

function parseBatch(searchParams: URLSearchParams): number {
  const parsed = Number.parseInt(searchParams.get("batch") ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return Math.min(50, parsed);
}

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request);
  if (blocked) return blocked;

  try {
    verifyCronSecret(request);

    const { searchParams } = new URL(request.url);
    const batch = parseBatch(searchParams);
    const worker = searchParams.get("worker")?.trim() || "snapshot-cron";
    const result = await processSnapshotJobs(batch, worker);

    log({
      level: "info",
      service: "api-cron-snapshots",
      message: "Snapshot jobs processed",
      batch,
      worker,
      claimed: result.claimed,
      succeeded: result.succeeded,
      failed: result.failed
    });

    return okResponse({
      ok: true,
      ...result
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error, { route: "api-cron-snapshots" });
    }

    return errorResponse(error, { route: "api-cron-snapshots" });
  }
}
