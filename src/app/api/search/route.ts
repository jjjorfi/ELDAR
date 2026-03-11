import { NextResponse } from "next/server";

import { runRouteGuards } from "@/lib/api/route-security";
import { searchSymbols } from "@/lib/features/search/service";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-search",
    max: 120,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  const url = new URL(request.url);
  const result = await searchSymbols(url.searchParams.get("q") ?? "", url.searchParams.get("limit"));

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      {
        status: result.status,
        headers: { "Cache-Control": result.cacheControl }
      }
    );
  }

  return NextResponse.json(
    { results: result.results },
    {
      headers: { "Cache-Control": result.cacheControl }
    }
  );
}
