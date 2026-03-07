// AI CONTEXT TRACE
// This file centralizes temporary free-tier quote/history fallback policy. It is
// intentionally a bridge layer while the project is still building on limited
// provider quotas, and it should be easy to remove once premium data is live.
// Gotcha: do not add new fundamentals logic here; this layer is only for quote
// and time-series continuity so the UI stays responsive during the build phase.

import { fetchAlphaVantageDailyHistory, fetchAlphaVantageQuoteSnapshot } from "@/lib/market/alpha-vantage";
import { fetchGoogleFinanceQuoteSnapshot } from "@/lib/market/google-finance";
import { fetchMarketstackDailyHistory, fetchMarketstackQuoteSnapshot } from "@/lib/market/marketstack";
import { fetchTwelveDataDailyHistory, fetchTwelveDataQuoteSnapshot } from "@/lib/market/twelvedata";

export interface TemporaryQuoteFallback {
  price: number | null;
  changePercent: number | null;
  asOfMs: number | null;
  source: "TWELVEDATA" | "GOOGLE_FINANCE" | "ALPHA_VANTAGE" | "MARKETSTACK" | null;
}

export interface TemporaryHistoryFallback {
  points: Array<{ date: Date; close: number | null }>;
  source: "TWELVEDATA" | "MARKETSTACK" | "ALPHA_VANTAGE" | null;
}

interface TemporaryHistoryOptions {
  range: string;
  interval: string;
  minimumPoints?: number;
}

function toMonthlyHistory(points: Array<{ date: Date; close: number | null }>): Array<{ date: Date; close: number | null }> {
  const buckets = new Map<string, { date: Date; close: number | null }>();

  for (const point of points) {
    if (point.close === null) continue;
    const key = `${point.date.getUTCFullYear()}-${String(point.date.getUTCMonth() + 1).padStart(2, "0")}`;
    const existing = buckets.get(key);
    if (!existing || point.date > existing.date) {
      buckets.set(key, point);
    }
  }

  return Array.from(buckets.values()).sort((a, b) => +a.date - +b.date);
}

function fallbackTargetDays(range: string, interval: string): number {
  if (interval === "1mo" && range === "12y") return 365 * 12;
  if (range === "5d") return 10;
  if (range === "1mo") return 40;
  if (range === "3mo") return 120;
  if (range === "6mo") return 220;
  if (range === "1y") return 366;
  if (range === "2y") return 730;
  if (range === "12y") return 365 * 12;
  return 366;
}

function defaultMinimumPoints(range: string, interval: string): number {
  if (interval === "1mo") return range === "12y" ? 110 : 12;
  if (range === "5d") return 2;
  if (range === "1mo") return 15;
  if (range === "3mo") return 45;
  if (range === "6mo") return 110;
  if (range === "1y") return 220;
  if (range === "2y") return 220;
  return 100;
}

function normalizeIntervalPoints(
  points: Array<{ date: Date; close: number | null }>,
  interval: string
): Array<{ date: Date; close: number | null }> {
  if (interval === "1mo") {
    return toMonthlyHistory(points);
  }
  return points;
}

export async function fetchTemporaryQuoteFallback(symbol: string): Promise<TemporaryQuoteFallback> {
  // Ranked temporary quote fallback order:
  // 1. Twelve Data: official API, good quote ergonomics.
  // 2. Google Finance: fresh page data, but unofficial scraping -> lower trust.
  // 3. Alpha Vantage: official, but often stale/daily-only for quote context.
  // 4. marketstack: EOD-oriented lowest-rank rescue path.
  const twelveData = await fetchTwelveDataQuoteSnapshot(symbol);
  if (twelveData.price !== null) {
    return {
      price: twelveData.price,
      changePercent: twelveData.changePercent,
      asOfMs: twelveData.asOfMs,
      source: "TWELVEDATA"
    };
  }

  const googleFinance = await fetchGoogleFinanceQuoteSnapshot(symbol);
  if (googleFinance.price !== null) {
    return {
      price: googleFinance.price,
      changePercent: googleFinance.changePercent,
      asOfMs: googleFinance.asOfMs,
      source: "GOOGLE_FINANCE"
    };
  }

  const alpha = await fetchAlphaVantageQuoteSnapshot(symbol);
  if (alpha.price !== null) {
    return {
      price: alpha.price,
      changePercent: null,
      asOfMs: alpha.asOfMs,
      source: "ALPHA_VANTAGE"
    };
  }

  const marketstack = await fetchMarketstackQuoteSnapshot(symbol);
  if (marketstack.price !== null) {
    return {
      price: marketstack.price,
      changePercent: marketstack.changePercent,
      asOfMs: marketstack.asOfMs,
      source: "MARKETSTACK"
    };
  }

  return {
    price: null,
    changePercent: null,
    asOfMs: null,
    source: null
  };
}

export async function fetchTemporaryHistoryFallback(
  symbol: string,
  options: TemporaryHistoryOptions
): Promise<TemporaryHistoryFallback> {
  // Ranked temporary history fallback order:
  // 1. Twelve Data daily series
  // 2. marketstack EOD history when window is short enough
  // 3. Alpha Vantage daily adjusted as the last official bridge
  const minimumPoints = options.minimumPoints ?? defaultMinimumPoints(options.range, options.interval);
  const targetDays = fallbackTargetDays(options.range, options.interval);
  let best: TemporaryHistoryFallback = { points: [], source: null };

  const twelveDataPoints = normalizeIntervalPoints(
    await fetchTwelveDataDailyHistory(symbol, targetDays + 40),
    options.interval
  );
  if (twelveDataPoints.length >= minimumPoints) {
    return { points: twelveDataPoints, source: "TWELVEDATA" };
  }
  if (twelveDataPoints.length > best.points.length) {
    best = { points: twelveDataPoints, source: "TWELVEDATA" };
  }

  if (targetDays <= 366) {
    const marketstackPoints = normalizeIntervalPoints(
      await fetchMarketstackDailyHistory(symbol, targetDays + 10),
      options.interval
    );
    if (marketstackPoints.length >= minimumPoints) {
      return { points: marketstackPoints, source: "MARKETSTACK" };
    }
    if (marketstackPoints.length > best.points.length) {
      best = { points: marketstackPoints, source: "MARKETSTACK" };
    }
  }

  const alphaPoints = normalizeIntervalPoints(await fetchAlphaVantageDailyHistory(symbol), options.interval);
  if (alphaPoints.length >= minimumPoints) {
    return { points: alphaPoints, source: "ALPHA_VANTAGE" };
  }
  if (alphaPoints.length > best.points.length) {
    best = { points: alphaPoints, source: "ALPHA_VANTAGE" };
  }

  return best;
}
