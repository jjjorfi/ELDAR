import { NextResponse } from "next/server";

import { errorResponse, okResponse } from "@/lib/api";
import { withApiPerfHeaders } from "@/lib/api/responses";
import { runRouteGuards } from "@/lib/api/route-security";
import { ValidationError } from "@/lib/errors";
import {
  getLiveQuotePayloadCached,
  parseLiveQuoteSymbols
} from "@/lib/features/price/live-service";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADER = "private, no-store";

export async function GET(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();
  const blocked = await runRouteGuards(request, {
    bucket: "api-price-live",
    max: 180,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const url = new URL(request.url);
    const symbols = parseLiveQuoteSymbols(url.searchParams.get("symbols") ?? url.searchParams.get("symbol"));
    if (symbols.length === 0) {
      throw new ValidationError("Missing symbols query parameter.");
    }

    const { payload, cache } = await getLiveQuotePayloadCached(symbols);

    log({
      level: "info",
      service: "api-price-live",
      message: "Live quotes fetched",
      symbolCount: symbols.length,
      cache,
      durationMs: Date.now() - startedAt
    });

    return okResponse(payload, {
      headers: withApiPerfHeaders(
        {
          "Cache-Control": CACHE_HEADER,
          "X-ELDAR-Data-State": payload.source
        },
        {
          startedAt,
          cache
        }
      )
    });
  } catch (error) {
    return errorResponse(
      error,
      { route: "api-price-live" },
      withApiPerfHeaders(
        { "Cache-Control": CACHE_HEADER },
        {
          startedAt,
          cache: "error"
        }
      )
    );
  }
}
