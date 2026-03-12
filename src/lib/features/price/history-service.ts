import { cacheGetJson, cacheSetJson } from "@/lib/cache/redis";
import { getFetchSignal } from "@/lib/market/adapter-utils";
import { fetchTemporaryHistoryFallback } from "@/lib/market/orchestration/temporary-fallbacks";
import { fetchSP500Directory } from "@/lib/market/universe/sp500";
import { resolveSp500DirectorySymbol } from "@/lib/market/universe/sp500-universe";
import { sanitizeSymbol } from "@/lib/utils";

import type { PriceHistoryPayload, PricePoint, PriceRange } from "@/lib/features/price/types";

interface ParsedChartRows {
  points: PricePoint[];
  latestPrice: number | null;
}

interface HistoryFallbackPoint {
  date: Date;
  close: number | null;
}

const RANGE_MAP: Record<PriceRange, { range: string; interval: string }> = {
  "1W": { range: "5d", interval: "1d" },
  "1M": { range: "1mo", interval: "1d" },
  "3M": { range: "3mo", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" }
};

const CACHE_TTL_MS = 2 * 60 * 1000;
const REDIS_CACHE_TTL_SECONDS = 10 * 60;
const FETCH_TIMEOUT_MS = 3_500;
const routeCache = new Map<string, { expiresAt: number; payload: PriceHistoryPayload }>();
const routeInFlight = new Map<string, Promise<PriceHistoryPayload>>();

function toYahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, "-");
}

export function parsePriceRange(raw: string | null): PriceRange {
  if (raw === "1W" || raw === "1M" || raw === "3M" || raw === "1Y") {
    return raw;
  }
  return "3M";
}

export async function resolveSupportedPriceHistorySymbol(rawSymbol: string): Promise<string | null> {
  const normalized = sanitizeSymbol(rawSymbol ?? "");
  if (!normalized) return null;
  const sp500Directory = await fetchSP500Directory();
  return resolveSp500DirectorySymbol(normalized, sp500Directory);
}

function minimumPointsForRange(range: PriceRange): number {
  if (range === "1W") return 2;
  if (range === "1M") return 15;
  if (range === "3M") return 45;
  return 220;
}

function parseRows(payload: unknown): ParsedChartRows {
  if (typeof payload !== "object" || payload === null) {
    return { points: [], latestPrice: null };
  }

  const chart = (payload as { chart?: unknown }).chart;
  if (typeof chart !== "object" || chart === null) {
    return { points: [], latestPrice: null };
  }

  const result = (chart as { result?: unknown[] }).result?.[0];
  if (typeof result !== "object" || result === null) {
    return { points: [], latestPrice: null };
  }

  const timestamps = Array.isArray((result as { timestamp?: unknown[] }).timestamp)
    ? ((result as { timestamp?: unknown[] }).timestamp as unknown[])
    : [];
  const adjCloses = Array.isArray((result as { indicators?: { adjclose?: Array<{ adjclose?: unknown[] }> } }).indicators?.adjclose?.[0]?.adjclose)
    ? ((result as { indicators?: { adjclose?: Array<{ adjclose?: unknown[] }> } }).indicators?.adjclose?.[0]?.adjclose as unknown[])
    : [];
  const closes = Array.isArray((result as { indicators?: { quote?: Array<{ close?: unknown[] }> } }).indicators?.quote?.[0]?.close)
    ? ((result as { indicators?: { quote?: Array<{ close?: unknown[] }> } }).indicators?.quote?.[0]?.close as unknown[])
    : [];
  const preferredPrices = adjCloses.length > 0 ? adjCloses : closes;
  const latestPriceRaw = (result as { meta?: { regularMarketPrice?: unknown } }).meta?.regularMarketPrice;
  const latestPrice = typeof latestPriceRaw === "number" && Number.isFinite(latestPriceRaw) ? latestPriceRaw : null;

  const points: PricePoint[] = [];

  for (let index = 0; index < Math.min(timestamps.length, preferredPrices.length); index += 1) {
    const ts = timestamps[index];
    const price = preferredPrices[index];
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) continue;
    points.push({
      time: new Date(ts * 1000).toISOString(),
      price
    });
  }

  return {
    points,
    latestPrice
  };
}

function computeChangePercent(points: PricePoint[], latestPrice: number | null): number | null {
  if (points.length < 2) return null;
  const first = points[0]?.price ?? null;
  const lastPoint = points[points.length - 1]?.price ?? null;
  const last = latestPrice ?? lastPoint;
  if (first === null || last === null || first === 0) return null;
  return ((last - first) / first) * 100;
}

function mapFallbackHistory(points: HistoryFallbackPoint[]): PricePoint[] {
  return points
    .filter((point): point is { date: Date; close: number } => point.close !== null && point.close > 0)
    .map((point) => ({
      time: point.date.toISOString(),
      price: point.close
    }))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

async function buildPriceHistoryPayload(symbol: string, range: PriceRange): Promise<PriceHistoryPayload> {
  const config = RANGE_MAP[range];
  const yahooSymbol = toYahooSymbol(symbol);
  const yahooUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`);
  yahooUrl.searchParams.set("range", config.range);
  yahooUrl.searchParams.set("interval", config.interval);
  const minimumPoints = minimumPointsForRange(range);

  let points: PricePoint[] = [];
  let latestPrice: number | null = null;
  let fallbackPoints: PricePoint[] = [];

  try {
    const fallback = await fetchTemporaryHistoryFallback(symbol, {
      range: config.range,
      interval: config.interval,
      minimumPoints
    });
    fallbackPoints = mapFallbackHistory(fallback.points);
    if (fallback.source === "ALPACA" && fallbackPoints.length >= minimumPoints) {
      points = fallbackPoints;
      latestPrice = points[points.length - 1]?.price ?? null;
    }
  } catch (error) {
    console.warn(`[Price History Service]: Alpaca-first fallback failed for ${symbol} ${range}.`, error);
  }

  if (points.length < minimumPoints) {
    try {
      const response = await fetch(yahooUrl.toString(), {
        cache: "no-store",
        signal: getFetchSignal(FETCH_TIMEOUT_MS),
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      });

      if (!response.ok) {
        throw new Error(`Yahoo chart request failed (${response.status})`);
      }

      const payload = (await response.json()) as unknown;
      const parsed = parseRows(payload);
      points = parsed.points;
      latestPrice = parsed.latestPrice;
    } catch (error) {
      console.warn(`[Price History Service]: Yahoo failed for ${symbol} ${range}.`, error);
    }
  }

  if (points.length < minimumPoints && fallbackPoints.length > points.length) {
    points = fallbackPoints;
    latestPrice = points[points.length - 1]?.price ?? latestPrice;
  }

  return {
    symbol,
    range,
    points,
    changePercent: computeChangePercent(points, latestPrice)
  };
}

export async function getPriceHistoryPayloadCached(
  symbol: string,
  range: PriceRange
): Promise<{ payload: PriceHistoryPayload; cache: "memory" | "redis" | "in-flight" | "computed" }> {
  const cacheKey = `${symbol}:${range}`;
  const redisKey = `price:history:v2:${cacheKey}`;
  const cached = routeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { payload: cached.payload, cache: "memory" };
  }

  const redisCached = await cacheGetJson<PriceHistoryPayload>(redisKey);
  if (redisCached) {
    routeCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload: redisCached
    });
    return { payload: redisCached, cache: "redis" };
  }

  let inFlight = routeInFlight.get(cacheKey);
  const hadInFlight = Boolean(inFlight);
  if (!inFlight) {
    inFlight = buildPriceHistoryPayload(symbol, range).finally(() => {
      routeInFlight.delete(cacheKey);
    });
    routeInFlight.set(cacheKey, inFlight);
  }

  const payload = await inFlight;
  routeCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    payload
  });
  await cacheSetJson(redisKey, payload, REDIS_CACHE_TTL_SECONDS);
  return { payload, cache: hadInFlight ? "in-flight" : "computed" };
}
