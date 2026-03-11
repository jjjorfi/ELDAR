import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { withApiPerfHeaders } from "@/lib/api/responses";
import { runRouteGuards } from "@/lib/api/route-security";
import { getContextPayload } from "@/lib/features/context/service";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();
  const blocked = await runRouteGuards(request, {
    bucket: "api-context",
    max: 90,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  const { userId } = await auth();
  const { searchParams } = new URL(request.url);

  const result = await getContextPayload({
    rawSymbol: searchParams.get("symbol") ?? "",
    queryScoreRaw: searchParams.get("score"),
    liveRaw: searchParams.get("live"),
    userId: userId ?? null
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      {
        status: result.status,
        headers: withApiPerfHeaders(
          { "Cache-Control": result.cacheControl },
          {
            startedAt,
            cache: result.cache
          }
        )
      }
    );
  }

  return NextResponse.json(result.payload, {
    headers: withApiPerfHeaders(
      {
        "Cache-Control": result.cacheControl
      },
      {
        startedAt,
        cache: result.cache
      }
    )
  });
}
