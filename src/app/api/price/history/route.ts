import { NextResponse } from "next/server";

import { runRouteGuards } from "@/lib/api/route-security";
import { getFetchSignal } from "@/lib/market/adapter-utils";
import { fetchTemporaryHistoryFallback } from "@/lib/market/temporary-fallbacks";
import { isTop100Sp500Symbol } from "@/lib/market/top100";
import { sanitizeSymbol } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PriceRange = "1W" | "1M" | "3M" | "1Y";

interface PricePoint {
  time: string;
  price: number;
}

interface PriceHistoryPayload {
  symbol: string;
  range: PriceRange;
  points: PricePoint[];
  changePercent: number | null;
}

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
const CACHE_HEADER = "public, max-age=60, s-maxage=120, stale-while-revalidate=240";
const FETCH_TIMEOUT_MS = 3_500;
const routeCache = new Map<string, { expiresAt: number; payload: PriceHistoryPayload }>();

function toYahooSymbol(symbol: string): string {
  // Yahoo chart endpoints use hyphen for class shares (e.g. BRK-B).
  return symbol.replace(/\./g, "-");
}

function parseRange(raw: string | null): PriceRange {
  if (raw === "1W" || raw === "1M" || raw === "3M" || raw === "1Y") {
    return raw;
  }
  return "3M";
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
    const iso = new Date(ts * 1000).toISOString();
    points.push({
      time: iso,
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

export async function GET(request: Request): Promise<NextResponse> {
  const blocked = await runRouteGuards(request, {
    bucket: "api-price-history",
    max: 120,
    windowMs: 60_000
  });
  if (blocked) return blocked;

  try {
    const url = new URL(request.url);
    const symbol = sanitizeSymbol(url.searchParams.get("symbol") ?? "");
    const range = parseRange(url.searchParams.get("range"));

    if (!symbol) {
      return NextResponse.json({ error: "Missing symbol query parameter." }, { status: 400 });
    }
    if (!isTop100Sp500Symbol(symbol)) {
      return NextResponse.json({ error: "ELDAR currently supports Top 100 S&P 500 symbols only." }, { status: 400 });
    }

    const cacheKey = `${symbol}:${range}`;
    const cached = routeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.payload, { headers: { "Cache-Control": CACHE_HEADER } });
    }

    const config = RANGE_MAP[range];
    const yahooSymbol = toYahooSymbol(symbol);
    const yahooUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`);
    yahooUrl.searchParams.set("range", config.range);
    yahooUrl.searchParams.set("interval", config.interval);

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
      console.warn(`[Price History API]: Yahoo failed for ${symbol} ${range}. Falling back to temporary providers.`, error);
    }

    if (points.length < 2) {
      // Temporary patch: use free-tier history bridges while premium market-data
      // rates are not yet in place.
      const fallback = await fetchTemporaryHistoryFallback(symbol, {
        range: config.range,
        interval: config.interval,
        minimumPoints: range === "1W" ? 2 : range === "1M" ? 15 : range === "3M" ? 45 : 220
      });
      points = mapFallbackHistory(fallback.points);
      latestPrice = points[points.length - 1]?.price ?? latestPrice;
    }

    const result: PriceHistoryPayload = {
      symbol,
      range,
      points,
      changePercent: computeChangePercent(points, latestPrice)
    };

    routeCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload: result
    });

    return NextResponse.json(result, { headers: { "Cache-Control": CACHE_HEADER } });
  } catch (error) {
    console.error("/api/price/history GET error", error);
    return NextResponse.json(
      {
        error: "Failed to fetch price history."
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
