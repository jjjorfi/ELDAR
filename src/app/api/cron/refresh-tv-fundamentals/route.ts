import { NextResponse } from "next/server";

import { errorResponse, okResponse } from "@/lib/api";
import { runRouteGuards } from "@/lib/api/route-security";
import { verifyCronSecret } from "@/lib/auth";
import { AuthError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { runSP500FundamentalsRefresh } from "@/lib/providers/tradingview-fundamentals";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request);
  if (blocked) {
    return blocked;
  }

  try {
    verifyCronSecret(request);

    const result = await runSP500FundamentalsRefresh();
    log({
      level: "info",
      service: "api-cron-tv-fundamentals",
      message: "TradingView fundamentals refresh completed",
      fetched: result.fetched,
      failed: result.failed,
      durationMs: result.durationMs
    });

    return okResponse({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error, { route: "api-cron-refresh-tv-fundamentals" });
    }

    return errorResponse(error, { route: "api-cron-refresh-tv-fundamentals" });
  }
}
