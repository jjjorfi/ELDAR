import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { addToWatchlist, getWatchlist, removeFromWatchlist } from "@/lib/storage";
import guard, { isGuardBlockedError } from "@/lib/security/guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { publishWatchlistDelta } from "@/lib/realtime/publisher";
import { sanitizeSymbol } from "@/lib/utils";

export const runtime = "nodejs";

const payloadSchema = z.object({
  symbol: z.string().min(1).max(12)
});

export async function GET(request: Request): Promise<NextResponse> {
  try {
    // Shared security gate: protected-route policy + global rolling per-IP limit.
    await guard(request);
  } catch (error) {
    if (isGuardBlockedError(error)) {
      return error.response;
    }
    throw error;
  }

  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const throttled = enforceRateLimit(request, {
      bucket: "api-watchlist-get",
      max: 180,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    const watchlist = await getWatchlist(userId);
    return NextResponse.json({ watchlist }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("/api/watchlist GET error", error);
    return NextResponse.json({ error: "Failed to load watchlist." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Shared security gate: protected-route policy + global rolling per-IP limit.
    await guard(request);
  } catch (error) {
    if (isGuardBlockedError(error)) {
      return error.response;
    }
    throw error;
  }

  try {
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const throttled = enforceRateLimit(request, {
      bucket: "api-watchlist-post",
      max: 120,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    const body = await request.json();
    const parsed = payloadSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const symbol = sanitizeSymbol(parsed.data.symbol);

    if (!symbol) {
      return NextResponse.json({ error: "Ticker symbol is invalid." }, { status: 400 });
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

    return NextResponse.json({ watchlist }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("/api/watchlist POST error", error);
    return NextResponse.json({ error: "Failed to add symbol." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    // Shared security gate: protected-route policy + global rolling per-IP limit.
    await guard(request);
  } catch (error) {
    if (isGuardBlockedError(error)) {
      return error.response;
    }
    throw error;
  }

  try {
    const { userId, orgId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const throttled = enforceRateLimit(request, {
      bucket: "api-watchlist-delete",
      max: 120,
      windowMs: 60_000
    });
    if (throttled) return throttled;

    const url = new URL(request.url);
    const symbol = sanitizeSymbol(url.searchParams.get("symbol") ?? "");

    if (!symbol) {
      return NextResponse.json({ error: "Ticker symbol is required." }, { status: 400 });
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

    return NextResponse.json({ watchlist }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("/api/watchlist DELETE error", error);
    return NextResponse.json({ error: "Failed to remove symbol." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
