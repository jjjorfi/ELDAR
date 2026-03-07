import { NextResponse } from "next/server";

import { runRouteGuards } from "@/lib/api/route-security";
import { getHomeDashboardPayload, parseSectorWindow } from "@/lib/home/dashboard-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-home-dashboard",
    max: 90,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const url = new URL(request.url);
    const sectorWindow = parseSectorWindow(url.searchParams.get("sectorWindow"));
    const payload = await getHomeDashboardPayload(sectorWindow);

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build dashboard payload.";
    console.error(`[API Home Dashboard]: ${message}`);
    return NextResponse.json(
      { error: "Failed to build dashboard payload." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
