import { NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, okResponse } from "@/lib/api";
import { runRouteGuards } from "@/lib/api/route-security";
import { verifyCronSecret } from "@/lib/auth";
import { AuthError, ValidationError } from "@/lib/errors";
import { log } from "@/lib/logger";
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

  try {
    verifyCronSecret(request);

    const raw = await request.json().catch(() => ({}));
    const parsed = replayPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ValidationError("Invalid payload.");
    }

    const symbol = parsed.data.symbol ? sanitizeSymbol(parsed.data.symbol) : null;
    if (parsed.data.symbol && !symbol) {
      throw new ValidationError("Invalid symbol.");
    }

    const result = await replayDeadSnapshotJobs({
      limit: parsed.data.limit,
      symbol,
      jobIds: parsed.data.jobIds
    });

    log({
      level: "info",
      service: "api-system-snapshot-replay",
      message: "Dead-letter snapshot jobs replayed",
      requeued: result.requeued,
      symbol
    });

    return okResponse({
      ok: true,
      requeued: result.requeued
    });
  } catch (error) {
    if (error instanceof AuthError || error instanceof ValidationError) {
      return errorResponse(error, { route: "api-system-snapshot-replay" });
    }

    return errorResponse(error, { route: "api-system-snapshot-replay" });
  }
}
