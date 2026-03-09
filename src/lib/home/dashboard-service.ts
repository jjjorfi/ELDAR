import { cacheGetJson, cacheSetJson } from "@/lib/cache/redis";
import {
  DEFAULT_SECTOR_WINDOW,
  fetchSectorPerformance
} from "@/lib/market/sector-performance";
import { GICS_SECTORS, GICS_SECTOR_ETFS } from "@/lib/market/gics-sectors";
import { getTop100Sp500Symbols } from "@/lib/market/top100";
import { buildDashboardNewsFocusSymbols, getDashboardMarketNews } from "@/lib/home/dashboard-news";
import { getDashboardMacroRegime } from "@/lib/home/dashboard-macro";
import { normalizeSectorName } from "@/lib/scoring/sector-config";
import { getRecentAnalyses } from "@/lib/storage";
import type { PersistedAnalysis } from "@/lib/types";

import { fetchDashboardQuoteMap, type QuoteRow, quoteValue, toYahooSymbol } from "@/lib/home/dashboard-quotes";
import type {
  HomeDashboardPayload,
  HomeMarketMoverItem as MarketMoverItem,
  HomeSectorRotationItem as SectorRotationItem,
  HomeSnapshotItem as SnapshotItem,
  SectorRotationWindow
} from "@/lib/home/dashboard-types";

const CACHE_TTL_MS = 90_000;
const REDIS_TTL_SECONDS = 90;
const FALLBACK_MOVER_SYMBOLS = getTop100Sp500Symbols();

export type Tone = "positive" | "neutral" | "negative";

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
      signalStrength: (signalScore === null ? "UNAVAILABLE" : ratingBandFromScore(signalScore)) as SectorRotationItem["signalStrength"]
    };
  }).sort((left, right) => (right.performancePercent ?? -999) - (left.performancePercent ?? -999));
}

function buildMarketMovers(
  symbols: string[],
  quoteMap: Map<string, QuoteRow>,
  companyNames: Map<string, string>
): HomeDashboardPayload["marketMovers"] {
  const uniqueSymbols = Array.from(new Set(symbols.map((value) => value.trim().toUpperCase()).filter(Boolean)));
  const movers: MarketMoverItem[] = [];

  for (const symbol of uniqueSymbols) {
    const quote = quoteValue(quoteMap, symbol, toYahooSymbol(symbol));
    const changePercent = quote?.regularMarketChangePercent ?? null;
    if (changePercent === null) continue;

    movers.push({
      symbol,
      companyName: companyNames.get(symbol) ?? symbol,
      currentPrice: quote?.regularMarketPrice ?? null,
      changePercent
    });
  }

  return movers.sort((left, right) => {
    const absDelta = Math.abs(right.changePercent) - Math.abs(left.changePercent);
    if (absDelta !== 0) return absDelta;
    return right.changePercent - left.changePercent || left.symbol.localeCompare(right.symbol);
  });
}

async function fetchSectorWindowPerformance(window: SectorRotationWindow): Promise<Map<string, number | null>> {
  return fetchSectorPerformance(GICS_SECTOR_ETFS, window);
}

async function buildPayload(
  sectorWindow: SectorRotationWindow,
  previous: HomeDashboardPayload | null
): Promise<HomeDashboardPayload> {
  const analyses = await getRecentAnalyses(900, null);
  const carriedSymbols = Array.from(new Set(analyses.map((row) => row.symbol.trim().toUpperCase()).filter(Boolean))).slice(0, 140);
  const moverSymbols = Array.from(new Set([...carriedSymbols.slice(0, 60), ...FALLBACK_MOVER_SYMBOLS]));
  const newsFocusSymbols = buildDashboardNewsFocusSymbols(carriedSymbols, moverSymbols);
  const latest = latestBySymbol(analyses);
  const companyNames = new Map<string, string>();
  for (const [symbol, analysis] of latest.entries()) {
    companyNames.set(symbol, analysis.companyName || symbol);
  }

  const coreSymbols = [
    "^GSPC",
    "^NDX",
    "^RUT",
    "DX-Y.NYB",
    "DX=F",
    "^VIX",
    "CL=F",
    "^TNX",
    ...GICS_SECTOR_ETFS
  ];

  const [quoteMap, sectorWindowPerformance, marketNews, macroRegime] = await Promise.all([
    fetchDashboardQuoteMap(coreSymbols, moverSymbols),
    fetchSectorWindowPerformance(sectorWindow),
    getDashboardMarketNews(newsFocusSymbols),
    getDashboardMacroRegime(previous?.regime ?? null)
  ]);
  const dxy = quoteValue(quoteMap, "DX-Y.NYB", "DX=F");
  const vix = quoteValue(quoteMap, "^VIX");

  let snapshot: SnapshotItem[] = [
    { symbol: "^GSPC", label: "SPX", price: quoteValue(quoteMap, "^GSPC")?.regularMarketPrice ?? null, changePercent: quoteValue(quoteMap, "^GSPC")?.regularMarketChangePercent ?? null },
    { symbol: "^NDX", label: "NDX", price: quoteValue(quoteMap, "^NDX")?.regularMarketPrice ?? null, changePercent: quoteValue(quoteMap, "^NDX")?.regularMarketChangePercent ?? null },
    { symbol: "^RUT", label: "RUT", price: quoteValue(quoteMap, "^RUT")?.regularMarketPrice ?? null, changePercent: quoteValue(quoteMap, "^RUT")?.regularMarketChangePercent ?? null },
    { symbol: dxy?.symbol ?? "DX-Y.NYB", label: "DXY", price: dxy?.regularMarketPrice ?? null, changePercent: dxy?.regularMarketChangePercent ?? null },
    { symbol: "^VIX", label: "VIX", price: vix?.regularMarketPrice ?? null, changePercent: vix?.regularMarketChangePercent ?? null }
  ];

  let regime = macroRegime;
  let sectorRotation = buildSectorRotation(analyses, quoteMap, sectorWindowPerformance);
  let marketMovers = buildMarketMovers(moverSymbols, quoteMap, companyNames);

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
        signalStrength: signalScore === null ? "UNAVAILABLE" : ratingBandFromScore(signalScore)
      };
    });

    if (marketMovers.length < 12 && previous.marketMovers.length > 0) {
      const seen = new Set(marketMovers.map((item) => item.symbol));
      const carryForward = previous.marketMovers.filter((item) => !seen.has(item.symbol));
      marketMovers = [...marketMovers, ...carryForward].slice(0, 18);
    }

    if (regime.metrics.length === 0) {
      regime = previous.regime;
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

export async function getHomeDashboardPayload(window: SectorRotationWindow): Promise<HomeDashboardPayload> {
  const memoryCached = payloadCacheByWindow.get(window);
  if (memoryCached && Date.now() < memoryCached.expiresAt) {
    return memoryCached.payload;
  }

  const redisCached = await cacheGetJson<HomeDashboardPayload>(dashboardRedisKey(window));
  if (redisCached) {
    payloadCacheByWindow.set(window, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload: redisCached
    });
    return redisCached;
  }

  let inFlight = payloadInFlightByWindow.get(window);
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

  return inFlight;
}
