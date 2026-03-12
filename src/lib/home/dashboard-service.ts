import { cacheGetJson, cacheSetJson } from "@/lib/cache/redis";
import {
  DEFAULT_SECTOR_WINDOW,
  fetchSectorPerformance
} from "@/lib/market/orchestration/sector-performance";
import { GICS_SECTORS, GICS_SECTOR_ETFS } from "@/lib/market/universe/gics-sectors";
import { buildDashboardNewsFocusSymbols, getDashboardMarketNews } from "@/lib/home/dashboard-news";
import { getDashboardMacroRegime } from "@/lib/home/dashboard-macro";
import { fetchTopSp500Movers } from "@/lib/home/sp500-movers";
import { normalizeSectorName } from "@/lib/scoring/sector/config";
import { getRecentAnalyses } from "@/lib/storage/index";
import type { PersistedAnalysis } from "@/lib/types";

import { fetchDashboardQuoteMap, type QuoteRow, quoteValue } from "@/lib/home/dashboard-quotes";
import type {
  HomeDashboardPayload,
  HomeSectorRotationItem as SectorRotationItem,
  HomeSnapshotItem as SnapshotItem,
  SectorRotationWindow
} from "@/lib/home/dashboard-types";

const CACHE_TTL_MS = 180_000;
const REDIS_TTL_SECONDS = 180;
const REQUIRED_MOVER_BUCKET_SIZE = 3;

export type Tone = "positive" | "neutral" | "negative";
export type HomeDashboardCacheLayer = "memory" | "redis" | "in-flight" | "computed";
export interface HomeDashboardPayloadResult {
  payload: HomeDashboardPayload;
  cacheLayer: HomeDashboardCacheLayer;
}

let payloadCacheByWindow = new Map<SectorRotationWindow, { expiresAt: number; payload: HomeDashboardPayload }>();
let payloadInFlightByWindow = new Map<SectorRotationWindow, Promise<HomeDashboardPayload>>();

function dashboardRedisKey(window: SectorRotationWindow): string {
  return `home:dashboard:v3:${window}`;
}

export function parseSectorWindow(raw: string | null): SectorRotationWindow {
  const value = (raw ?? "").trim().toUpperCase();
  if (value === "1M" || value === "3M" || value === "6M" || value === "YTD") {
    return value;
  }
  return DEFAULT_SECTOR_WINDOW;
}

function percentTone(value: number | null): Tone {
  if (value === null) return "neutral";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function ratingBandFromScore(score: number): "STRONG" | "CONSTRUCTIVE" | "NEUTRAL" | "WEAK" {
  if (score >= 7.9) return "STRONG";
  if (score >= 6.3) return "CONSTRUCTIVE";
  if (score >= 4.1) return "NEUTRAL";
  return "WEAK";
}

function countMoverBuckets(items: HomeDashboardPayload["marketMovers"]): { winners: number; losers: number } {
  let winners = 0;
  let losers = 0;
  for (const item of items) {
    if (item.changePercent > 0) winners += 1;
    if (item.changePercent < 0) losers += 1;
  }
  return { winners, losers };
}

function hasRequiredMoverBuckets(items: HomeDashboardPayload["marketMovers"], perBucket = REQUIRED_MOVER_BUCKET_SIZE): boolean {
  const counts = countMoverBuckets(items);
  return counts.winners >= perBucket && counts.losers >= perBucket;
}

function normalizeMoverBuckets(
  current: HomeDashboardPayload["marketMovers"],
  previous: HomeDashboardPayload["marketMovers"],
  perBucket: number
): HomeDashboardPayload["marketMovers"] {
  const seen = new Set<string>();
  const winners: HomeDashboardPayload["marketMovers"] = [];
  const losers: HomeDashboardPayload["marketMovers"] = [];

  const addBySign = (
    target: HomeDashboardPayload["marketMovers"],
    source: HomeDashboardPayload["marketMovers"],
    sign: "W" | "L"
  ): void => {
    for (const item of source) {
      if (target.length >= perBucket) break;
      if (seen.has(item.symbol)) continue;
      if (sign === "W" && item.changePercent <= 0) continue;
      if (sign === "L" && item.changePercent >= 0) continue;
      target.push(item);
      seen.add(item.symbol);
    }
  };

  addBySign(
    winners,
    [...current]
      .filter((item) => item.changePercent > 0)
      .sort((a, b) => b.changePercent - a.changePercent || a.symbol.localeCompare(b.symbol)),
    "W"
  );
  addBySign(
    losers,
    [...current]
      .filter((item) => item.changePercent < 0)
      .sort((a, b) => a.changePercent - b.changePercent || a.symbol.localeCompare(b.symbol)),
    "L"
  );

  if (winners.length < perBucket || losers.length < perBucket) {
    addBySign(
      winners,
      [...previous]
        .filter((item) => item.changePercent > 0)
        .sort((a, b) => b.changePercent - a.changePercent || a.symbol.localeCompare(b.symbol)),
      "W"
    );
    addBySign(
      losers,
      [...previous]
        .filter((item) => item.changePercent < 0)
        .sort((a, b) => a.changePercent - b.changePercent || a.symbol.localeCompare(b.symbol)),
      "L"
    );
  }

  return [...winners, ...losers].sort(
    (a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent) || b.changePercent - a.changePercent || a.symbol.localeCompare(b.symbol)
  );
}

function latestBySymbol(rows: PersistedAnalysis[]): Map<string, PersistedAnalysis> {
  const bySymbol = new Map<string, PersistedAnalysis>();
  for (const row of rows) {
    if (!bySymbol.has(row.symbol)) {
      bySymbol.set(row.symbol, row);
    }
  }
  return bySymbol;
}

function buildSectorRotation(
  rows: PersistedAnalysis[],
  quoteMap: Map<string, QuoteRow>,
  periodPerformanceByEtf: Map<string, number | null>
): HomeDashboardPayload["sectorRotation"] {
  const latest = latestBySymbol(rows);
  const bucket = new Map<string, number[]>();

  for (const item of latest.values()) {
    const sector = normalizeSectorName(item.sector);
    const key = sector === "Other" ? "Other" : sector;
    const values = bucket.get(key) ?? [];
    values.push(item.score);
    bucket.set(key, values);
  }

  return GICS_SECTORS.map((sector) => {
    const values = bucket.get(sector.sector) ?? [];
    const signalScore = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const quote = quoteValue(quoteMap, sector.etf);
    const periodPerformance = periodPerformanceByEtf.get(sector.etf) ?? null;
    return {
      etf: sector.etf,
      name: sector.displayName,
      performancePercent: periodPerformance ?? quote?.regularMarketChangePercent ?? null,
      signalScore: signalScore !== null ? Math.round(signalScore * 10) / 10 : null,
      signalStrength: (signalScore === null ? "NEUTRAL" : ratingBandFromScore(signalScore)) as SectorRotationItem["signalStrength"]
    };
  }).sort((left, right) => (right.performancePercent ?? -999) - (left.performancePercent ?? -999));
}

async function fetchSectorWindowPerformance(window: SectorRotationWindow): Promise<Map<string, number | null>> {
  return fetchSectorPerformance(GICS_SECTOR_ETFS, window);
}

async function buildPayload(
  sectorWindow: SectorRotationWindow,
  previous: HomeDashboardPayload | null
): Promise<HomeDashboardPayload> {
  const analysesPromise = getRecentAnalyses(900, null);
  const topMoversPromise = fetchTopSp500Movers(3);
  const sectorWindowPerformancePromise = fetchSectorWindowPerformance(sectorWindow);
  const macroRegimePromise = getDashboardMacroRegime(previous?.regime ?? null);

  const [analyses, topMovers, sectorWindowPerformance, macroRegime] = await Promise.all([
    analysesPromise,
    topMoversPromise,
    sectorWindowPerformancePromise,
    macroRegimePromise
  ]);

  const carriedSymbols = Array.from(
    new Set(
      analyses
        .map((row) => row.symbol.trim().toUpperCase())
        .filter((symbol) => symbol.length > 0 && symbol !== "SYMBOL")
    )
  ).slice(0, 140);
  const moverSymbols = topMovers.map((item) => item.symbol);
  const newsFocusSymbols = buildDashboardNewsFocusSymbols(carriedSymbols, moverSymbols);

  const coreSymbols = [
    "^GSPC",
    "^NDX",
    "^RUT",
    "DX-Y.NYB",
    "DX=F",
    "^VIX",
    "CL=F",
    "^TNX"
  ];

  const [quoteMap, marketNews] = await Promise.all([
    fetchDashboardQuoteMap(coreSymbols, []),
    getDashboardMarketNews(newsFocusSymbols),
  ]);
  let snapshot: SnapshotItem[] = [
    { symbol: "^GSPC", label: "SPX", price: quoteValue(quoteMap, "^GSPC")?.regularMarketPrice ?? null, changePercent: quoteValue(quoteMap, "^GSPC")?.regularMarketChangePercent ?? null },
    { symbol: "^NDX", label: "NDX", price: quoteValue(quoteMap, "^NDX")?.regularMarketPrice ?? null, changePercent: quoteValue(quoteMap, "^NDX")?.regularMarketChangePercent ?? null },
    { symbol: "^RUT", label: "RUT", price: quoteValue(quoteMap, "^RUT")?.regularMarketPrice ?? null, changePercent: quoteValue(quoteMap, "^RUT")?.regularMarketChangePercent ?? null }
  ];

  let regime = macroRegime;
  let sectorRotation = buildSectorRotation(analyses, quoteMap, sectorWindowPerformance);
  let marketMovers = topMovers;

  if (previous) {
    snapshot = snapshot.map((item) => {
      const prior = previous.snapshot.find((candidate) => candidate.label === item.label);
      return {
        ...item,
        price: item.price ?? prior?.price ?? null,
        changePercent: item.changePercent ?? prior?.changePercent ?? null
      };
    });

    sectorRotation = sectorRotation.map((item) => {
      const prior = previous.sectorRotation.find((candidate) => candidate.etf === item.etf);
      const performancePercent = item.performancePercent ?? prior?.performancePercent ?? null;
      const signalScore = item.signalScore ?? prior?.signalScore ?? null;
      return {
        ...item,
        performancePercent,
        signalScore,
        signalStrength: signalScore === null ? "NEUTRAL" : ratingBandFromScore(signalScore)
      };
    });

    const currentBuckets = countMoverBuckets(marketMovers);
    if ((currentBuckets.winners < 3 || currentBuckets.losers < 3) && previous.marketMovers.length > 0) {
      marketMovers = normalizeMoverBuckets(marketMovers, previous.marketMovers, 3);
    }

    if (regime.metrics.length === 0) {
      regime = previous.regime;
    }
  }

  if (previous && marketMovers.length > 0) {
    const currentBuckets = countMoverBuckets(marketMovers);
    if (currentBuckets.winners < 3 || currentBuckets.losers < 3) {
      marketMovers = normalizeMoverBuckets(marketMovers, previous.marketMovers, 3);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sectorWindow,
    regime,
    snapshot,
    marketMovers,
    sectorRotation,
    marketNews
  };
}

export async function getHomeDashboardPayloadWithMeta(window: SectorRotationWindow): Promise<HomeDashboardPayloadResult> {
  const memoryCached = payloadCacheByWindow.get(window);
  if (memoryCached && Date.now() < memoryCached.expiresAt && hasRequiredMoverBuckets(memoryCached.payload.marketMovers)) {
    return {
      payload: memoryCached.payload,
      cacheLayer: "memory"
    };
  }

  const redisCached = await cacheGetJson<HomeDashboardPayload>(dashboardRedisKey(window));
  if (redisCached && hasRequiredMoverBuckets(redisCached.marketMovers)) {
    payloadCacheByWindow.set(window, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload: redisCached
    });
    return {
      payload: redisCached,
      cacheLayer: "redis"
    };
  }

  let inFlight = payloadInFlightByWindow.get(window);
  const hadInFlight = Boolean(inFlight);
  if (!inFlight) {
    inFlight = buildPayload(window, memoryCached?.payload ?? redisCached ?? null)
      .then(async (payload) => {
        payloadCacheByWindow.set(window, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          payload
        });
        await cacheSetJson(dashboardRedisKey(window), payload, REDIS_TTL_SECONDS);
        return payload;
      })
      .finally(() => {
        payloadInFlightByWindow.delete(window);
      });
    payloadInFlightByWindow.set(window, inFlight);
  }

  return {
    payload: await inFlight,
    cacheLayer: hadInFlight ? "in-flight" : "computed"
  };
}

export async function getHomeDashboardPayload(window: SectorRotationWindow): Promise<HomeDashboardPayload> {
  return (await getHomeDashboardPayloadWithMeta(window)).payload;
}

export async function getHomeDashboardPayloadCached(window: SectorRotationWindow): Promise<HomeDashboardPayload | null> {
  const memoryCached = payloadCacheByWindow.get(window);
  if (memoryCached && Date.now() < memoryCached.expiresAt && hasRequiredMoverBuckets(memoryCached.payload.marketMovers)) {
    return memoryCached.payload;
  }

  const redisCached = await cacheGetJson<HomeDashboardPayload>(dashboardRedisKey(window));
  if (!redisCached || !hasRequiredMoverBuckets(redisCached.marketMovers)) {
    return null;
  }

  payloadCacheByWindow.set(window, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    payload: redisCached
  });
  return redisCached;
}
