import { NextResponse } from "next/server";

import { runRouteGuards } from "@/lib/api/route-security";
import { EARNINGS_CACHE_HEADER, getEarningsPayload } from "@/lib/features/earnings/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-earnings",
    max: 90,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  const result = await getEarningsPayload();

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      {
        status: result.status,
        headers: { "Cache-Control": result.cacheControl }
      }
    );
  }

  return NextResponse.json(result.payload, {
    headers: { "Cache-Control": result.cacheControl || EARNINGS_CACHE_HEADER }
  });
}
