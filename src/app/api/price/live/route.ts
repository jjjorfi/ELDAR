import { NextResponse } from "next/server";

import { withApiPerfHeaders } from "@/lib/api/responses";
import { runRouteGuards } from "@/lib/api/route-security";
import {
  getLiveQuotePayloadCached,
  parseLiveQuoteSymbols
} from "@/lib/features/price/live-service";

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
      return NextResponse.json(
        { error: "Missing symbols query parameter." },
        {
          status: 400,
          headers: withApiPerfHeaders(
            { "Cache-Control": CACHE_HEADER },
            {
              startedAt,
              cache: "error"
            }
          )
        }
      );
    }

    const { payload, cache } = await getLiveQuotePayloadCached(symbols);

    return NextResponse.json(payload, {
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
    console.error("/api/price/live GET error", error);
    return NextResponse.json(
      {
        quotes: [],
        error: "Failed to fetch live quotes."
      },
      {
        status: 200,
        headers: withApiPerfHeaders(
          { "Cache-Control": CACHE_HEADER },
          {
            startedAt,
            cache: "error"
          }
        )
      }
    );
  }
}
