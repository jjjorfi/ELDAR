import { NextResponse } from "next/server";
import { z } from "zod";

import { runRouteGuards } from "@/lib/api/route-security";
import { isAuthorizedAdminRequest } from "@/lib/security/admin";
import { replayDeadSnapshotJobs } from "@/lib/snapshots/service";
import { sanitizeSymbol } from "@/lib/utils";

export const runtime = "nodejs";

const replayPayloadSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  symbol: z.string().min(1).max(12).optional(),
  jobIds: z.array(z.string().min(1).max(128)).max(500).optional()
});

export async function POST(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-system-snapshot-replay",
    max: 30,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const raw = await request.json().catch(() => ({}));
    const parsed = replayPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const symbol = parsed.data.symbol ? sanitizeSymbol(parsed.data.symbol) : null;
    if (parsed.data.symbol && !symbol) {
      return NextResponse.json({ error: "Invalid symbol." }, { status: 400 });
    }

    const result = await replayDeadSnapshotJobs({
      limit: parsed.data.limit,
      symbol,
      jobIds: parsed.data.jobIds
    });

    return NextResponse.json({
      ok: true,
      requeued: result.requeued
    });
  } catch (error) {
    console.error("/api/system/snapshots/replay POST error", error);
    return NextResponse.json({ error: "Failed to replay dead-letter snapshot jobs." }, { status: 500 });
  }
}
