import type { NextResponse } from "next/server";

import { errorResponse, okResponse } from "@/lib/api";
import { withApiPerfHeaders } from "@/lib/api/responses";
import { runRouteGuards } from "@/lib/api/route-security";
import { ValidationError } from "@/lib/errors";
import {
  parsePriceRange,
  resolveSupportedPriceHistorySymbol
} from "@/lib/features/price/history-service";
import { resolvePriceHistoryPayload } from "@/lib/features/price/history-read";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADER = "public, max-age=60, s-maxage=120, stale-while-revalidate=240";

/**
 * Returns the cached price-history payload for a supported symbol and range.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();
  const blocked = await runRouteGuards(request, {
    bucket: "api-price-history",
    max: 120,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const url = new URL(request.url);
    const rawSymbol = url.searchParams.get("symbol") ?? "";
    const range = parsePriceRange(url.searchParams.get("range"));

    if (!rawSymbol.trim()) {
      throw new ValidationError("Missing symbol query parameter.");
    }

    const symbol = await resolveSupportedPriceHistorySymbol(rawSymbol);
    if (!symbol) {
      throw new ValidationError("ELDAR currently supports S&P 500 symbols only.");
    }

    const resolved = await resolvePriceHistoryPayload(symbol, range);
    if (!resolved.payload) {
      return okResponse(
        {
          pending: true,
          symbol,
          range,
          refreshQueued: resolved.enqueued
        },
        {
          status: 202,
          headers: withApiPerfHeaders(
            {
              "Cache-Control": "no-store"
            },
            {
              startedAt,
              cache: resolved.cacheLayer
            }
          )
        }
      );
    }

    const payload = resolved.payload;
    log({
      level: "info",
      service: "api-price-history",
      message: "Price history resolved",
      symbol,
      range,
      cacheLayer: resolved.cacheLayer,
      snapshotState: resolved.snapshotState,
      durationMs: Date.now() - startedAt
    });

    return okResponse(payload, {
      headers: withApiPerfHeaders(
        {
          "Cache-Control": CACHE_HEADER,
          "X-ELDAR-Data-State": payload.points.length > 0 ? "available" : "empty",
          "X-ELDAR-Snapshot-State": resolved.snapshotState
        },
        {
          startedAt,
          cache: resolved.cacheLayer
        }
      )
    });
  } catch (error) {
    return errorResponse(
      error,
      { route: "api-price-history" },
      withApiPerfHeaders(
        { "Cache-Control": "no-store" },
        {
          startedAt,
          cache: "error"
        }
      )
    );
  }
}
