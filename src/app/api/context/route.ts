import { auth } from "@clerk/nextjs/server";

import { okResponse } from "@/lib/api";
import { withApiPerfHeaders } from "@/lib/api/responses";
import { runRouteGuards } from "@/lib/api/route-security";
import { getContextPayload } from "@/lib/features/context/service";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(request: Request) {
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
    return okResponse(
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

  log({
    level: "info",
    service: "api-context",
    message: "Context payload resolved",
    cache: result.cache,
    durationMs: Date.now() - startedAt
  });

  return okResponse(result.payload, {
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
