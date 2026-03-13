import { log } from "@/lib/logger";
import { getFetchSignal } from "@/lib/market/adapter-utils";
import { isNySessionOpen } from "@/lib/market/ny-session";
import { fetchSP500Directory } from "@/lib/market/universe/sp500";
import { resolveSp500DirectorySymbol } from "@/lib/market/universe/sp500-universe";
import { sanitizeSymbol } from "@/lib/utils";

import type { PriceHistoryPayload, PricePoint, PriceRange } from "@/lib/features/price/types";

interface ParsedChartRows {
  points: PricePoint[];
  latestPrice: number | null;
}

const RANGE_MAP: Record<PriceRange, { range: string; interval: string }> = {
  "1W": { range: "5d", interval: "1d" },
  "1M": { range: "1mo", interval: "1d" },
  "3M": { range: "3mo", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" }
};

const FETCH_TIMEOUT_MS = 3_500;
const LOG_TTL_MS = 60_000;
const recentWarnings = new Map<string, number>();
const PRICE_HISTORY_AGGREGATE_PREFIX = "price-history:v1";
const VALID_HISTORY_SYMBOL_PATTERN = /^[A-Z][A-Z0-9.\-]{0,14}$/;

function toYahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, "-");
}

export function parsePriceRange(raw: string | null): PriceRange {
  if (raw === "1W" || raw === "1M" || raw === "3M" || raw === "1Y") {
    return raw;
  }
  return "3M";
}

/**
 * Builds the aggregate snapshot key used for a symbol/range history payload.
 *
 * @param symbol - Supported uppercase symbol.
 * @param range - Requested history window.
 * @returns Aggregate snapshot key.
 */
export function priceHistoryAggregateKey(symbol: string, range: PriceRange): string {
  return `${PRICE_HISTORY_AGGREGATE_PREFIX}:${sanitizeSymbol(symbol)}:${range}`;
}

/**
 * Parses a price-history aggregate key into its typed parts.
 *
 * @param key - Aggregate snapshot key candidate.
 * @returns Parsed key parts or null when the format is invalid.
 */
export function parsePriceHistoryAggregateKey(key: string): { symbol: string; range: PriceRange } | null {
  const normalized = key.trim();
  const match = normalized.match(/^price-history:v1:([A-Z.\-]+):(1W|1M|3M|1Y)$/);
  if (!match) {
    return null;
  }

  const [, symbol, range] = match;
  const parsedRange = parsePriceRange(range);
  return {
    symbol,
    range: parsedRange
  };
}

/**
 * Computes the TTL for a price-history aggregate snapshot.
 *
 * @returns TTL in milliseconds.
 */
export function priceHistoryAggregateTtlMs(): number {
  return isNySessionOpen() ? 5 * 60_000 : 30 * 60_000;
}

/**
 * Resolves a request symbol to a supported S&P 500 symbol.
 *
 * @param rawSymbol - Raw symbol input from the request layer.
 * @returns Normalized supported symbol, or null when unsupported.
 */
export async function resolveSupportedPriceHistorySymbol(rawSymbol: string): Promise<string | null> {
  const normalized = sanitizeSymbol(rawSymbol ?? "");
  if (!normalized) return null;
  const sp500Directory = await fetchSP500Directory();
  const resolved = resolveSp500DirectorySymbol(normalized, sp500Directory);
  if (resolved) return resolved;
  return VALID_HISTORY_SYMBOL_PATTERN.test(normalized) ? normalized : null;
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

function warnOnce(scope: string, message: string): void {
  const key = `${scope}:${message}`;
  const now = Date.now();
  const previous = recentWarnings.get(key) ?? 0;
  if (now - previous < LOG_TTL_MS) {
    return;
  }
  recentWarnings.set(key, now);
  log({
    level: "warn",
    service: "price-history-service",
    message,
    scope
  });
}

async function buildPriceHistoryPayloadFromProvider(symbol: string, range: PriceRange): Promise<PriceHistoryPayload> {
  const config = RANGE_MAP[range];
  const yahooSymbol = toYahooSymbol(symbol);
  const yahooUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`);
  yahooUrl.searchParams.set("range", config.range);
  yahooUrl.searchParams.set("interval", config.interval);
  const minimumPoints = minimumPointsForRange(range);

  let points: PricePoint[] = [];
  let latestPrice: number | null = null;

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
    warnOnce("yahoo", `${symbol} ${range} primary history fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (points.length > 0 && points.length < minimumPoints) {
    warnOnce("insufficient", `${symbol} ${range} returned ${points.length} point(s); expected at least ${minimumPoints}`);
  }

  return {
    symbol,
    range,
    points,
    changePercent: computeChangePercent(points, latestPrice)
  };
}

/**
 * Builds a price-history payload from the upstream chart provider.
 *
 * This function is intended for background snapshot builders only. User-facing
 * request paths must read from persisted aggregate snapshots instead of calling
 * the upstream provider inline.
 *
 * @param symbol - Supported uppercase symbol.
 * @param range - Requested price-history range.
 * @returns Price-history payload.
 */
export async function buildPriceHistoryPayload(symbol: string, range: PriceRange): Promise<PriceHistoryPayload> {
  return buildPriceHistoryPayloadFromProvider(symbol, range);
}
