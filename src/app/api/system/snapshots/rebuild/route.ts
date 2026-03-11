import { NextResponse } from "next/server";
import { z } from "zod";

import { runRouteGuards } from "@/lib/api/route-security";
import { AGGREGATE_SNAPSHOT_KEYS } from "@/lib/snapshots/contracts";
import { requestAggregateSnapshotRefresh, requestSnapshotRefresh } from "@/lib/snapshots/service";
import { isAuthorizedAdminRequest } from "@/lib/security/admin";
import { sanitizeSymbol } from "@/lib/utils";

export const runtime = "nodejs";

const payloadSchema = z.object({
  symbol: z.string().min(1).max(12).optional(),
  aggregateKey: z.string().min(1).max(64).optional(),
  priority: z.enum(["hot", "portfolio", "watchlist", "scheduled", "repair"]).optional(),
  reason: z.string().min(3).max(120).optional()
});

export async function POST(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-system-snapshot-rebuild",
    max: 30,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  if (!isAuthorizedAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const raw = await request.json();
    const parsed = payloadSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const hasSymbol = typeof parsed.data.symbol === "string";
    const hasAggregateKey = typeof parsed.data.aggregateKey === "string";
    if ((hasSymbol && hasAggregateKey) || (!hasSymbol && !hasAggregateKey)) {
      return NextResponse.json({ error: "Provide exactly one of symbol or aggregateKey." }, { status: 400 });
    }

    if (hasSymbol) {
      const symbol = sanitizeSymbol(parsed.data.symbol ?? "");
      if (!symbol) {
        return NextResponse.json({ error: "Invalid symbol." }, { status: 400 });
      }

      const job = await requestSnapshotRefresh({
        symbol,
        priority: parsed.data.priority ?? "repair",
        reason: parsed.data.reason ?? "manual rebuild",
        requestedBy: "admin",
        payload: {}
      });

      return NextResponse.json({
        ok: true,
        symbol,
        kind: "symbol",
        jobId: job.id,
        created: job.created
      });
    }

    const key = parsed.data.aggregateKey?.trim() ?? "";
    const allowedKeys = new Set(Object.values(AGGREGATE_SNAPSHOT_KEYS));
    if (!allowedKeys.has(key as (typeof AGGREGATE_SNAPSHOT_KEYS)[keyof typeof AGGREGATE_SNAPSHOT_KEYS])) {
      return NextResponse.json({ error: "Unsupported aggregateKey." }, { status: 400 });
    }

    const job = await requestAggregateSnapshotRefresh({
      key,
      priority: parsed.data.priority ?? "repair",
      reason: parsed.data.reason ?? "manual aggregate rebuild",
      requestedBy: "admin",
      payload: {}
    });

    return NextResponse.json({
      ok: true,
      aggregateKey: key,
      kind: "aggregate",
      jobId: job.id,
      created: job.created
    });
  } catch (error) {
    console.error("/api/system/snapshots/rebuild POST error", error);
    return NextResponse.json({ error: "Failed to enqueue snapshot rebuild." }, { status: 500 });
  }
}
