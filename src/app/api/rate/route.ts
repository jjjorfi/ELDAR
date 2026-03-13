import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

import { okResponse, errorResponse } from "@/lib/api";
import { withApiPerfHeaders } from "@/lib/api/responses";
import { runRouteGuards } from "@/lib/api/route-security";
import { ValidationError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { fetchSP500Directory } from "@/lib/market/universe/sp500";
import { resolveSp500DirectorySymbol } from "@/lib/market/universe/sp500-universe";
import { getCachedAnalysis } from "@/lib/storage/index";
import { getSnapshotForRead } from "@/lib/snapshots/service";
import type { PersistedAnalysis } from "@/lib/types";
import { sanitizeSymbol } from "@/lib/utils";

export const runtime = "nodejs";

const payloadSchema = z.object({
  symbol: z.string().min(1).max(12)
});

const CACHE_FRESH_MS = 30_000;
const HOT_SYMBOL_CACHE_MS = 20_000;

const hotSymbolCache = new Map<string, { expiresAt: number; analysis: PersistedAnalysis }>();

function isCachedAnalysisFresh(analysis: PersistedAnalysis): boolean {
  const createdAtMs = Date.parse(analysis.createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }
  return Date.now() - createdAtMs < CACHE_FRESH_MS;
}

function hotSymbolKey(symbol: string): string {
  return symbol.toUpperCase();
}

function getHotCached(symbol: string): PersistedAnalysis | null {
  const key = hotSymbolKey(symbol);
  const cached = hotSymbolCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    hotSymbolCache.delete(key);
    return null;
  }
  return cached.analysis;
}

function setHotCached(analysis: PersistedAnalysis): void {
  hotSymbolCache.set(hotSymbolKey(analysis.symbol), {
    analysis,
    expiresAt: Date.now() + HOT_SYMBOL_CACHE_MS
  });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const blocked = await runRouteGuards(request, {
    bucket: "api-rate",
    max: 60,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const { userId } = await auth();

    const rawBody = await request.json();
    const parsed = payloadSchema.safeParse(rawBody);

    if (!parsed.success) {
      throw new ValidationError("Invalid payload. Expected: { symbol: string }");
    }

    const symbol = sanitizeSymbol(parsed.data.symbol);

    if (!symbol) {
      throw new ValidationError("Ticker symbol is invalid.");
    }

    const sp500Directory = await fetchSP500Directory();
    const canonicalSymbol = resolveSp500DirectorySymbol(symbol, sp500Directory);
    if (!canonicalSymbol) {
      throw new ValidationError("ELDAR currently supports S&P 500 symbols only.");
    }

    const hotCached = getHotCached(canonicalSymbol);
    if (hotCached) {
      return okResponse(
        { analysis: hotCached, cached: true },
        {
          headers: withApiPerfHeaders(undefined, {
            startedAt,
            cache: "memory"
          })
        }
      );
    }

    const snapshotRead = await getSnapshotForRead({
      symbol: canonicalSymbol,
      priority: "hot",
      reason: "api-rate",
      requestedBy: userId ?? null
    });

    const snapshotAnalysis = snapshotRead.snapshot?.modules.analysis.data ?? null;
    if (snapshotAnalysis) {
      setHotCached(snapshotAnalysis);
      log({
        level: "info",
        service: "api-rate",
        message: "Rating resolved from snapshot",
        symbol: canonicalSymbol,
        snapshotState: snapshotRead.state,
        durationMs: Date.now() - startedAt
      });

      return okResponse(
        {
          analysis: snapshotAnalysis,
          cached: snapshotRead.state !== "fresh",
          fresh: snapshotRead.state === "fresh",
          snapshotState: snapshotRead.state,
          refreshQueued: snapshotRead.enqueued
        },
        {
          headers: withApiPerfHeaders(undefined, {
            startedAt,
            cache: snapshotRead.state === "fresh" ? "snapshot" : "snapshot-stale"
          })
        }
      );
    }

    let cached = await getCachedAnalysis(canonicalSymbol, 60 * 24 * 30, userId ?? null);
    if (!cached && userId) {
      cached = await getCachedAnalysis(canonicalSymbol, 60 * 24 * 30, null);
    }
    if (cached) {
      setHotCached(cached);
      log({
        level: "info",
        service: "api-rate",
        message: "Rating resolved from cached analysis",
        symbol: canonicalSymbol,
        durationMs: Date.now() - startedAt
      });

      return okResponse(
        {
          analysis: cached,
          cached: true,
          fresh: isCachedAnalysisFresh(cached),
          snapshotState: "missing",
          refreshQueued: snapshotRead.enqueued
        },
        {
          headers: withApiPerfHeaders(undefined, {
            startedAt,
            cache: "database"
          })
        }
      );
    }

    return okResponse(
      {
        error: "Snapshot is warming up.",
        pending: true,
        snapshotState: snapshotRead.state,
        refreshQueued: snapshotRead.enqueued
      },
      {
        status: 202,
        headers: withApiPerfHeaders(undefined, {
          startedAt,
          cache: "warming"
        })
      }
    );
  } catch (error) {
    return errorResponse(
      error,
      { route: "api-rate" },
      withApiPerfHeaders(undefined, {
        startedAt,
        cache: "error"
      })
    );
  }
}
