import { cacheGetJson, cacheSetJson } from "@/lib/cache/redis";
import { fetchTemporaryQuoteFallback } from "@/lib/market/orchestration/temporary-fallbacks";
import { getSnapshotForRead } from "@/lib/snapshots/service";
import { sanitizeSymbol } from "@/lib/utils";

import type { LiveQuotePayload, LiveQuoteRow } from "@/lib/features/price/types";

const MAX_SYMBOLS = 24;
const LIVE_ROUTE_CACHE_TTL_MS = 1_000;
const LIVE_ROUTE_REDIS_TTL_SECONDS = 10;

const liveRouteCache = new Map<string, { expiresAt: number; payload: LiveQuotePayload }>();
const liveRouteInFlight = new Map<string, Promise<LiveQuotePayload>>();

interface QuickQuoteRow extends LiveQuoteRow {}

export function parseLiveQuoteSymbols(raw: string | null): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((value) => sanitizeSymbol(value))
        .filter((value) => value.length > 0)
    )
  ).slice(0, MAX_SYMBOLS);
}

function liveRouteCacheKey(symbols: string[]): string {
  return symbols.map((symbol) => symbol.toUpperCase()).sort().join(",");
}

function liveRouteRedisKey(symbols: string[]): string {
  return `price:live:v2:${liveRouteCacheKey(symbols)}`;
}

function parseIsoMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface SnapshotQuoteRead {
  symbol: string;
  price: number | null;
  changePercent: number | null;
  asOfMs: number | null;
}

async function readSnapshotQuote(symbol: string): Promise<SnapshotQuoteRead> {
  try {
    const read = await getSnapshotForRead({
      symbol,
      priority: "hot",
      reason: "api-price-live",
      requestedBy: null
    });
    const analysis = read.snapshot?.modules.analysis.data ?? null;
    const price = typeof analysis?.currentPrice === "number" && Number.isFinite(analysis.currentPrice) && analysis.currentPrice > 0
      ? analysis.currentPrice
      : null;

    return {
      symbol,
      price,
      changePercent: null,
      asOfMs: parseIsoMs(analysis?.createdAt ?? read.snapshot?.asOf ?? null)
    };
  } catch (error) {
    console.warn(`[Live Quote Service]: snapshot read failed for ${symbol}.`, error);
    return {
      symbol,
      price: null,
      changePercent: null,
      asOfMs: null
    };
  }
}

async function buildLiveQuotePayload(symbols: string[]): Promise<LiveQuotePayload> {
  const snapshotRows = await Promise.all(symbols.map((symbol) => readSnapshotQuote(symbol)));
  const missingSymbols = snapshotRows.filter((row) => row.price === null).map((row) => row.symbol);

  const fallbackRows = await Promise.all(
    missingSymbols.map(async (symbol): Promise<QuickQuoteRow> => {
      const snapshot = await fetchTemporaryQuoteFallback(symbol, { fast: true });
      return {
        symbol,
        price: snapshot.price,
        changePercent: snapshot.changePercent,
        asOfMs: snapshot.asOfMs
      };
    })
  );

  const snapshotMap = new Map(snapshotRows.map((row) => [row.symbol, row]));
  const fallbackMap = new Map(fallbackRows.map((row) => [row.symbol, row]));

  const quotes: LiveQuoteRow[] = symbols.map((symbol) => {
    const fromSnapshot = snapshotMap.get(symbol);
    const fallback = fallbackMap.get(symbol);
    const resolvedPrice = fromSnapshot?.price ?? fallback?.price ?? null;
    const resolvedAsOfMs = fromSnapshot?.asOfMs ?? fallback?.asOfMs ?? null;
    const resolvedChangePercent = fallback?.changePercent ?? fromSnapshot?.changePercent ?? null;
    return {
      symbol,
      price: resolvedPrice,
      changePercent: resolvedChangePercent,
      asOfMs: resolvedAsOfMs
    };
  });

  const hasSnapshotData = snapshotRows.some((row) => row.price !== null);
  const usedFallback = fallbackRows.length > 0;
  const source = hasSnapshotData
    ? usedFallback
      ? "SNAPSHOT+HTTP_POLL"
      : "SNAPSHOT"
    : "HTTP_POLL";

  return {
    quotes,
    source,
    fetchedAt: new Date().toISOString()
  };
}

export async function getLiveQuotePayloadCached(
  symbols: string[]
): Promise<{ payload: LiveQuotePayload; cache: "memory" | "redis" | "in-flight" | "computed" }> {
  const key = liveRouteCacheKey(symbols);
  const redisKey = liveRouteRedisKey(symbols);
  const now = Date.now();
  const cached = liveRouteCache.get(key);
  if (cached && cached.expiresAt > now) {
    return { payload: cached.payload, cache: "memory" };
  }

  const redisCached = await cacheGetJson<LiveQuotePayload>(redisKey);
  if (redisCached) {
    liveRouteCache.set(key, {
      expiresAt: now + LIVE_ROUTE_CACHE_TTL_MS,
      payload: redisCached
    });
    return { payload: redisCached, cache: "redis" };
  }

  let inFlight = liveRouteInFlight.get(key);
  const hadInFlight = Boolean(inFlight);
  if (!inFlight) {
    inFlight = buildLiveQuotePayload(symbols).finally(() => {
      liveRouteInFlight.delete(key);
    });
    liveRouteInFlight.set(key, inFlight);
  }

  const payload = await inFlight;
  liveRouteCache.set(key, {
    expiresAt: Date.now() + LIVE_ROUTE_CACHE_TTL_MS,
    payload
  });
  await cacheSetJson(redisKey, payload, LIVE_ROUTE_REDIS_TTL_SECONDS);

  return {
    payload,
    cache: hadInFlight ? "in-flight" : "computed"
  };
}
