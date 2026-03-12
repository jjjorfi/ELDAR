import { NextResponse } from "next/server";

import { getApiAuthContext } from "@/lib/api/auth-context";
import { internalServerError, jsonNoStore, unauthorized } from "@/lib/api/responses";
import { runRouteGuards } from "@/lib/api/route-security";
import { getRecentAnalyses } from "@/lib/storage/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-history",
    max: 120,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const authContext = await getApiAuthContext();
    if (!authContext) {
      return unauthorized();
    }
    const { userId } = authContext;

    const url = new URL(request.url);
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20;

    const analyses = await getRecentAnalyses(safeLimit, userId);
    return jsonNoStore({ analyses });
  } catch (error) {
    console.error("/api/history error", error);
    return internalServerError("Failed to load history.");
  }
}
