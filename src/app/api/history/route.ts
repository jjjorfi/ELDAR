import { errorResponse, okResponse } from "@/lib/api";
import { getApiAuthContext } from "@/lib/api/auth-context";
import { withApiPerfHeaders } from "@/lib/api/responses";
import { runRouteGuards } from "@/lib/api/route-security";
import { AuthError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { getRecentAnalyses } from "@/lib/storage/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = Date.now();
  const blocked = await runRouteGuards(request, {
    bucket: "api-history",
    max: 120,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const authContext = await getApiAuthContext();
    if (!authContext) {
      throw new AuthError("Unauthenticated");
    }
    const { userId } = authContext;

    const url = new URL(request.url);
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20;

    const analyses = await getRecentAnalyses(safeLimit, userId);
    log({
      level: "info",
      service: "api-history",
      message: "History loaded",
      userId,
      count: analyses.length,
      durationMs: Date.now() - startedAt
    });

    return okResponse(
      { analyses },
      {
        headers: withApiPerfHeaders(
          { "Cache-Control": "no-store" },
          {
            startedAt,
            cache: "database"
          }
        )
      }
    );
  } catch (error) {
    return errorResponse(
      error,
      { route: "api-history" },
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
