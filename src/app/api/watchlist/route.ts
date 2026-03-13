import { NextResponse } from "next/server";
import { z } from "zod";

import { getApiAuthContext } from "@/lib/api/auth-context";
import { errorResponse, okResponse } from "@/lib/api";
import { runRouteGuards } from "@/lib/api/route-security";
import { AuthError, ValidationError } from "@/lib/errors";
import { log } from "@/lib/logger";
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
      throw new AuthError("Unauthenticated");
    }
    const { userId } = authContext;

    const watchlist = await getWatchlist(userId);
    log({
      level: "info",
      service: "api-watchlist",
      message: "Watchlist loaded",
      userId,
      count: watchlist.length
    });
    return okResponse(
      { watchlist },
      {
        headers: { "Cache-Control": "no-store" }
      }
    );
  } catch (error) {
    return errorResponse(error, { route: "api-watchlist-get" });
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
      throw new AuthError("Unauthenticated");
    }
    const { userId, orgId } = authContext;

    const body = await request.json();
    const parsed = payloadSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError("Invalid payload.");
    }

    const symbol = sanitizeSymbol(parsed.data.symbol);

    if (!symbol) {
      throw new ValidationError("Ticker symbol is invalid.");
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

    log({
      level: "info",
      service: "api-watchlist",
      message: "Watchlist symbol added",
      userId,
      symbol,
      count: watchlist.length
    });

    return okResponse(
      { watchlist },
      {
        headers: { "Cache-Control": "no-store" }
      }
    );
  } catch (error) {
    return errorResponse(error, { route: "api-watchlist-post" });
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
      throw new AuthError("Unauthenticated");
    }
    const { userId, orgId } = authContext;

    const url = new URL(request.url);
    const symbol = sanitizeSymbol(url.searchParams.get("symbol") ?? "");

    if (!symbol) {
      throw new ValidationError("Ticker symbol is required.");
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

    log({
      level: "info",
      service: "api-watchlist",
      message: "Watchlist symbol removed",
      userId,
      symbol,
      count: watchlist.length
    });

    return okResponse(
      { watchlist },
      {
        headers: { "Cache-Control": "no-store" }
      }
    );
  } catch (error) {
    return errorResponse(error, { route: "api-watchlist-delete" });
  }
}
