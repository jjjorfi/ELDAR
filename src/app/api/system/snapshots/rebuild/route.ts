import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, okResponse } from "@/lib/api";
import { runRouteGuards } from "@/lib/api/route-security";
import { verifyCronSecret } from "@/lib/auth";
import { AuthError, ValidationError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { AGGREGATE_SNAPSHOT_KEYS } from "@/lib/snapshots/contracts";
import { requestAggregateSnapshotRefresh, requestSnapshotRefresh } from "@/lib/snapshots/service";
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

  try {
    verifyCronSecret(request);

    const raw = await request.json();
    const parsed = payloadSchema.parse(raw);

    const hasSymbol = typeof parsed.symbol === "string";
    const hasAggregateKey = typeof parsed.aggregateKey === "string";
    if ((hasSymbol && hasAggregateKey) || (!hasSymbol && !hasAggregateKey)) {
      throw new ValidationError("Provide exactly one of symbol or aggregateKey.");
    }

    if (hasSymbol) {
      const symbol = sanitizeSymbol(parsed.symbol ?? "");
      if (!symbol) {
        throw new ValidationError("Invalid symbol.");
      }

      const job = await requestSnapshotRefresh({
        symbol,
        priority: parsed.priority ?? "repair",
        reason: parsed.reason ?? "manual rebuild",
        requestedBy: "admin",
        payload: {}
      });

      log({
        level: "info",
        service: "api-system-snapshot-rebuild",
        message: "Snapshot rebuild enqueued",
        kind: "symbol",
        symbol,
        created: job.created
      });

      return okResponse({
        ok: true,
        symbol,
        kind: "symbol",
        jobId: job.id,
        created: job.created
      });
    }

    const key = parsed.aggregateKey?.trim() ?? "";
    const allowedKeys = new Set(Object.values(AGGREGATE_SNAPSHOT_KEYS));
    if (!allowedKeys.has(key as (typeof AGGREGATE_SNAPSHOT_KEYS)[keyof typeof AGGREGATE_SNAPSHOT_KEYS])) {
      throw new ValidationError("Unsupported aggregateKey.");
    }

    const job = await requestAggregateSnapshotRefresh({
      key,
      priority: parsed.priority ?? "repair",
      reason: parsed.reason ?? "manual aggregate rebuild",
      requestedBy: "admin",
      payload: {}
    });

    log({
      level: "info",
      service: "api-system-snapshot-rebuild",
      message: "Aggregate snapshot rebuild enqueued",
      kind: "aggregate",
      aggregateKey: key,
      created: job.created
    });

    return okResponse({
      ok: true,
      aggregateKey: key,
      kind: "aggregate",
      jobId: job.id,
      created: job.created
    });
  } catch (error) {
    if (error instanceof AuthError || error instanceof ValidationError) {
      return errorResponse(error, { route: "api-system-snapshot-rebuild" });
    }

    return errorResponse(error, { route: "api-system-snapshot-rebuild" });
  }
}
