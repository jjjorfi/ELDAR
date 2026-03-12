import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiAuthContext } from "@/lib/api/auth-context";
import { badRequest, internalServerError, jsonNoStore, unauthorized } from "@/lib/api/responses";
import { runRouteGuards } from "@/lib/api/route-security";
import { addToWatchlist, getWatchlist, removeFromWatchlist } from "@/lib/storage/index";
import { publishWatchlistDelta } from "@/lib/realtime/publisher";
import { sanitizeSymbol } from "@/lib/utils";

export const runtime = "nodejs";

const payloadSchema = z.object({
  symbol: z.string().min(1).max(12)
});

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-watchlist-get",
    max: 180,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const authContext = await getApiAuthContext();
    if (!authContext) {
      return unauthorized();
    }
    const { userId } = authContext;

    const watchlist = await getWatchlist(userId);
    return jsonNoStore({ watchlist });
  } catch (error) {
    console.error("/api/watchlist GET error", error);
    return internalServerError("Failed to load watchlist.");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-watchlist-post",
    max: 120,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const authContext = await getApiAuthContext();
    if (!authContext) {
      return unauthorized();
    }
    const { userId, orgId } = authContext;

    const body = await request.json();
    const parsed = payloadSchema.safeParse(body);

    if (!parsed.success) {
      return badRequest("Invalid payload.");
    }

    const symbol = sanitizeSymbol(parsed.data.symbol);

    if (!symbol) {
      return badRequest("Ticker symbol is invalid.");
    }

    await addToWatchlist(symbol, userId);
    const watchlist = await getWatchlist(userId);
    await publishWatchlistDelta({
      userId,
      orgId: orgId ?? null,
      symbol,
      action: "added",
      changedAt: new Date().toISOString()
    });

    return jsonNoStore({ watchlist });
  } catch (error) {
    console.error("/api/watchlist POST error", error);
    return internalServerError("Failed to add symbol.");
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-watchlist-delete",
    max: 120,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const authContext = await getApiAuthContext();
    if (!authContext) {
      return unauthorized();
    }
    const { userId, orgId } = authContext;

    const url = new URL(request.url);
    const symbol = sanitizeSymbol(url.searchParams.get("symbol") ?? "");

    if (!symbol) {
      return badRequest("Ticker symbol is required.");
    }

    await removeFromWatchlist(symbol, userId);
    const watchlist = await getWatchlist(userId);
    await publishWatchlistDelta({
      userId,
      orgId: orgId ?? null,
      symbol,
      action: "removed",
      changedAt: new Date().toISOString()
    });

    return jsonNoStore({ watchlist });
  } catch (error) {
    console.error("/api/watchlist DELETE error", error);
    return internalServerError("Failed to remove symbol.");
  }
}
