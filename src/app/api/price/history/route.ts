import { NextResponse } from "next/server";

import { withApiPerfHeaders } from "@/lib/api/responses";
import { runRouteGuards } from "@/lib/api/route-security";
import {
  getPriceHistoryPayloadCached,
  parsePriceRange,
  resolveSupportedPriceHistorySymbol
} from "@/lib/features/price/history-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADER = "public, max-age=60, s-maxage=120, stale-while-revalidate=240";

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
      return NextResponse.json({ error: "Missing symbol query parameter." }, { status: 400 });
    }
    const symbol = await resolveSupportedPriceHistorySymbol(rawSymbol);
    if (!symbol) {
      return NextResponse.json({ error: "ELDAR currently supports S&P 500 symbols only." }, { status: 400 });
    }

    const { payload, cache } = await getPriceHistoryPayloadCached(symbol, range);

    return NextResponse.json(payload, {
      headers: withApiPerfHeaders(
        {
          "Cache-Control": CACHE_HEADER,
          "X-ELDAR-Data-State": payload.points.length > 0 ? "available" : "empty"
        },
        {
          startedAt,
          cache
        }
      )
    });
  } catch (error) {
    console.error("/api/price/history GET error", error);
    return NextResponse.json(
      {
        error: "Failed to fetch price history."
      },
      {
        status: 500,
        headers: withApiPerfHeaders(
          { "Cache-Control": "no-store" },
          {
            startedAt,
            cache: "error"
          }
        )
      }
    );
  }
}
