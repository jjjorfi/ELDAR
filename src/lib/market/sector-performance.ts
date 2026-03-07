// AI CONTEXT TRACE
// This module centralizes sector ETF performance fetching for both the home dashboard
// and the standalone sectors page. It fetches one-year daily Yahoo chart history,
// computes windowed returns (YTD/1M/3M/6M), and caches parsed history in-memory so
// subsequent requests are fast. Gotcha: this cache is process-local, so a cold server
// start still pays the first Yahoo fetch cost until the cache is warm again.

import { getFetchSignal } from "@/lib/market/adapter-utils";
import { cacheGetJson, cacheSetJson } from "@/lib/cache/redis";

export type SectorPerformanceWindow = "YTD" | "1M" | "3M" | "6M";
export type SectorSentiment = "bullish" | "neutral" | "bearish";

export const DEFAULT_SECTOR_WINDOW: SectorPerformanceWindow = "YTD";

const YAHOO_SECTOR_HISTORY_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const SECTOR_HISTORY_TTL_MS = 30 * 60_000;
const SECTOR_FETCH_TIMEOUT_MS = 3_500;
const SECTOR_HISTORY_REDIS_TTL_SECONDS = 6 * 60 * 60;

interface PricePoint {
  isoDate: string;
  timestampMs: number;
  close: number;
}

let sectorHistoryCache = new Map<string, { expiresAt: number; points: PricePoint[] }>();
let sectorHistoryInFlight = new Map<string, Promise<PricePoint[]>>();

function sectorHistoryRedisKey(symbol: string): string {
  return `market:sector-history:${symbol.toUpperCase()}:1y`;
}

function safeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseYahooPricePoints(payload: unknown): PricePoint[] {
  const parsed = payload as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            close?: Array<number | null>;
          }>;
        };
      }>;
    };
  };

  const result = parsed.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];

  return timestamps
    .map((timestampSec, index) => {
      const close = closes[index];
      if (typeof close !== "number" || !Number.isFinite(close)) return null;
      const timestampMs = Math.round(timestampSec * 1000);
      if (!Number.isFinite(timestampMs)) return null;
      const date = new Date(timestampMs);
      if (Number.isNaN(date.getTime())) return null;
      return {
        isoDate: date.toISOString().slice(0, 10),
        timestampMs,
        close
      };
    })
    .filter((point): point is PricePoint => point !== null);
}

function periodDays(window: Exclude<SectorPerformanceWindow, "YTD">): number {
  if (window === "1M") return 31;
  if (window === "3M") return 92;
  return 184;
}

function computeWindowChangePercent(points: PricePoint[], window: SectorPerformanceWindow): number | null {
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  if (!latest || latest.close === 0) return null;

  let baseline: PricePoint | null = null;
  if (window === "YTD") {
    const currentYear = new Date(latest.timestampMs).getUTCFullYear();
    baseline = points.find((point) => point.isoDate.startsWith(`${currentYear}-`)) ?? points[0] ?? null;
  } else {
    const cutoff = latest.timestampMs - periodDays(window) * 24 * 60 * 60 * 1000;
    baseline = points.find((point) => point.timestampMs >= cutoff) ?? points[0] ?? null;
  }

  if (!baseline || baseline.close === 0) return null;
  return ((latest.close - baseline.close) / Math.abs(baseline.close)) * 100;
}

async function fetchYahooSectorHistory(symbol: string): Promise<PricePoint[]> {
  const cacheKey = symbol.toUpperCase();
  const cached = sectorHistoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.points;
  }

  const redisCached = await cacheGetJson<PricePoint[]>(sectorHistoryRedisKey(cacheKey));
  if (Array.isArray(redisCached) && redisCached.length > 0) {
    sectorHistoryCache.set(cacheKey, {
      expiresAt: Date.now() + SECTOR_HISTORY_TTL_MS,
      points: redisCached
    });
    return redisCached;
  }

  let inFlight = sectorHistoryInFlight.get(cacheKey);
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const url = new URL(`${YAHOO_SECTOR_HISTORY_URL}/${encodeURIComponent(symbol)}`);
        url.searchParams.set("interval", "1d");
        url.searchParams.set("range", "1y");

        const response = await fetch(url.toString(), {
          cache: "no-store",
          signal: getFetchSignal(SECTOR_FETCH_TIMEOUT_MS),
          headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0"
          }
        });
        if (!response.ok) return [];

        const payload = await response.json();
        const points = parseYahooPricePoints(payload);
        sectorHistoryCache.set(cacheKey, {
          expiresAt: Date.now() + SECTOR_HISTORY_TTL_MS,
          points
        });
        if (points.length > 0) {
          await cacheSetJson(sectorHistoryRedisKey(cacheKey), points, SECTOR_HISTORY_REDIS_TTL_SECONDS);
        }
        return points;
      } catch {
        return [];
      } finally {
        sectorHistoryInFlight.delete(cacheKey);
      }
    })();
    sectorHistoryInFlight.set(cacheKey, inFlight);
  }

  return inFlight;
}

export async function fetchSectorPerformance(
  symbols: readonly string[],
  window: SectorPerformanceWindow
): Promise<Map<string, number | null>> {
  const entries = await Promise.all(
    symbols.map(async (symbol) => {
      const points = await fetchYahooSectorHistory(symbol);
      return [symbol.toUpperCase(), computeWindowChangePercent(points, window)] as const;
    })
  );

  return new Map(entries);
}

export function classifySectorSentiment(changePercent: number | null): SectorSentiment {
  if (typeof changePercent !== "number") return "neutral";
  if (changePercent >= 0.35) return "bullish";
  if (changePercent <= -0.35) return "bearish";
  return "neutral";
}
