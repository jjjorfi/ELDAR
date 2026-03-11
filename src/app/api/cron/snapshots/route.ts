import { NextResponse } from "next/server";

import { runRouteGuards } from "@/lib/api/route-security";
import { processSnapshotJobs } from "@/lib/snapshots/service";
import { isAuthorizedAdminRequest } from "@/lib/security/admin";

export const runtime = "nodejs";

function parseBatch(searchParams: URLSearchParams): number {
  const parsed = Number.parseInt(searchParams.get("batch") ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return Math.min(50, parsed);
}

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request);
  if (blocked) return blocked;

  if (!isAuthorizedAdminRequest(request) && request.headers.get("x-vercel-cron") !== "1") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const batch = parseBatch(searchParams);
    const worker = searchParams.get("worker")?.trim() || "snapshot-cron";
    const result = await processSnapshotJobs(batch, worker);
    return NextResponse.json({
      ok: true,
      ...result
    });
  } catch (error) {
    console.error("/api/cron/snapshots GET error", error);
    return NextResponse.json({ error: "Failed to process snapshot jobs." }, { status: 500 });
  }
}

