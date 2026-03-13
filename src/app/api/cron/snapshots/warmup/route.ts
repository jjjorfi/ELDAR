import { NextResponse } from "next/server";

import { errorResponse, okResponse } from "@/lib/api";
import { runRouteGuards } from "@/lib/api/route-security";
import { verifyCronSecret } from "@/lib/auth";
import { AuthError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { listDefaultAggregateKeys } from "@/lib/snapshots/aggregate";
import { requestAggregateSnapshotRefresh, requestSnapshotRefresh } from "@/lib/snapshots/service";
import { getRecentAnalyses } from "@/lib/storage/index";
import { sanitizeSymbol } from "@/lib/utils";

export const runtime = "nodejs";

const DEFAULT_SYMBOL_LIMIT = 60;
const CORE_WARMUP_SYMBOLS = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOGL",
  "META",
  "TSLA",
  "BRK.B",
  "JPM",
  "V",
  "XOM",
  "WMT",
  "UNH",
  "LLY",
  "PG",
  "MA",
  "AVGO",
  "SPY",
  "QQQ"
] as const;

function parseSymbolLimit(searchParams: URLSearchParams): number {
  const parsed = Number.parseInt(searchParams.get("symbolLimit") ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SYMBOL_LIMIT;
  return Math.min(200, parsed);
}

async function buildWarmupSymbols(limit: number): Promise<string[]> {
  const analyses = await getRecentAnalyses(Math.max(200, limit * 3), null).catch(() => []);
  const fromAnalyses = analyses
    .map((row) => sanitizeSymbol(row.symbol))
    .filter((symbol): symbol is string => Boolean(symbol));
  const merged = [...CORE_WARMUP_SYMBOLS, ...fromAnalyses];
  const unique = new Set<string>();
  for (const symbol of merged) {
    if (unique.size >= limit) break;
    unique.add(symbol);
  }
  return Array.from(unique);
}

function aggregatePriority(key: string): "hot" | "scheduled" {
  if (key.startsWith("home-dashboard:")) return "hot";
  if (key === "movers:top3") return "hot";
  return "scheduled";
}

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request);
  if (blocked) return blocked;

  try {
    verifyCronSecret(request);

    const { searchParams } = new URL(request.url);
    const symbolLimit = parseSymbolLimit(searchParams);
    const symbols = await buildWarmupSymbols(symbolLimit);
    const aggregateKeys = listDefaultAggregateKeys();

    const [aggregateResults, symbolResults] = await Promise.all([
      Promise.all(
        aggregateKeys.map((key) =>
          requestAggregateSnapshotRefresh({
            key,
            priority: aggregatePriority(key),
            reason: "cron-warmup-aggregate",
            requestedBy: "cron",
            payload: {}
          })
        )
      ),
      Promise.all(
        symbols.map((symbol) =>
          requestSnapshotRefresh({
            symbol,
            priority: "watchlist",
            reason: "cron-warmup-symbol",
            requestedBy: "cron",
            payload: {}
          })
        )
      )
    ]);

    const aggregateCreated = aggregateResults.filter((result) => result.created).length;
    const symbolCreated = symbolResults.filter((result) => result.created).length;

    log({
      level: "info",
      service: "api-cron-snapshots-warmup",
      message: "Snapshot warmup jobs enqueued",
      symbolRequested: symbolResults.length,
      symbolCreated,
      aggregateRequested: aggregateResults.length,
      aggregateCreated
    });

    return okResponse({
      ok: true,
      aggregate: {
        requested: aggregateResults.length,
        created: aggregateCreated
      },
      symbols: {
        requested: symbolResults.length,
        created: symbolCreated
      }
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error, { route: "api-cron-snapshots-warmup" });
    }

    return errorResponse(error, { route: "api-cron-snapshots-warmup" });
  }
}
