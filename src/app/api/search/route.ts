import type { NextResponse } from "next/server";

import { errorResponse, okResponse } from "@/lib/api";
import { runRouteGuards } from "@/lib/api/route-security";
import { AppError } from "@/lib/errors";
import { SEARCH_CACHE_HEADER, searchSymbols } from "@/lib/features/search/service";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Searches the supported symbol universe.
 *
 * The search path is local-universe only so user requests do not fall through to
 * live provider lookups.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();
  const blocked = await runRouteGuards(request, {
    bucket: "api-search",
    max: 120,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const url = new URL(request.url);
    const result = await searchSymbols(url.searchParams.get("q") ?? "", url.searchParams.get("limit"));

    if (!result.ok) {
      throw new AppError(result.error, "SEARCH_ERROR", result.status);
    }

    log({
      level: "info",
      service: "api-search",
      message: "Search resolved",
      query: url.searchParams.get("q") ?? "",
      resultCount: result.results.length,
      durationMs: Date.now() - startedAt
    });

    return okResponse(
      { results: result.results },
      {
        headers: { "Cache-Control": result.cacheControl || SEARCH_CACHE_HEADER }
      }
    );
  } catch (error) {
    return errorResponse(error, { route: "api-search" }, { "Cache-Control": "no-store" });
  }
}
