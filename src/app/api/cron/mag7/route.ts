import { NextResponse } from "next/server";

import { runRouteGuards } from "@/lib/api/route-security";
import { refreshMag7ScoresIfDue } from "@/lib/mag7";
import { isAuthorizedAdminRequest } from "@/lib/security/admin";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request);
  if (blocked) return blocked;

  // Reuse constant-time secret comparison for cron/admin auth checks.
  // In local development we also keep Vercel's local cron marker for ergonomics.
  if (!isAuthorizedAdminRequest(request) && request.headers.get("x-vercel-cron") !== "1") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { refreshed, cards } = await refreshMag7ScoresIfDue();
    return NextResponse.json({
      ok: true,
      refreshed,
      count: cards.length,
      updatedAt: cards[0]?.updatedAt ?? null
    });
  } catch (error) {
    console.error("/api/cron/mag7 GET error", error);
    return NextResponse.json({ error: "Failed to refresh MAG 7 scores." }, { status: 500 });
  }
}
