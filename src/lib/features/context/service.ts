import { GICS_SECTORS } from "@/lib/market/universe/gics-sectors";
import { isNySessionOpen } from "@/lib/market/ny-session";
import { fetchSP500Directory } from "@/lib/market/universe/sp500";
import { buildSp500SymbolUniverse, resolveSp500DirectorySymbol } from "@/lib/market/universe/sp500-universe";
import { log } from "@/lib/logger";
import { resolveSectorFromCandidates } from "@/lib/scoring/sector/config";
import { getCachedAnalysis, getRecentAnalyses, getWatchlist } from "@/lib/storage/index";
import { getSnapshotForRead } from "@/lib/snapshots/service";
import type { PersistedAnalysis } from "@/lib/types";
import { sanitizeSymbol } from "@/lib/utils";

export interface ContextSimilarStock {
  symbol: string;
  companyName: string;
}

export interface ContextNewsItem {
  headline: string;
  url: string | null;
  source: string | null;
  publishedAt: string | null;
}

export interface ContextPayload {
  symbol: string;
  sector: string;
  sectorAverageScore: number | null;
  vsSectorPercent: number | null;
  similarStocks: ContextSimilarStock[];
  news: ContextNewsItem[];
}

export type ContextServiceCacheState = "memory" | "in-flight" | "computed" | "error";

export type ContextServiceResult =
  | {
      ok: true;
      status: 200;
      payload: ContextPayload;
      cacheControl: string;
      cache: Exclude<ContextServiceCacheState, "error">;
    }
  | {
      ok: false;
      status: 400 | 500;
      error: string;
      cacheControl: string;
      cache: "error";
    };

interface BuildContextPayloadOptions {
  symbol: string;
  queryScore: number | null;
  liveMode: boolean;
  userId: string | null;
  directoryMap: Record<string, { symbol: string; companyName: string; sector: string }>;
  symbolUniverse: Set<string>;
}

interface GetContextPayloadOptions {
  rawSymbol: string;
  queryScoreRaw: string | null;
  liveRaw: string | null;
  userId: string | null;
}

const CONTEXT_CACHE = new Map<string, { expiresAt: number; payload: ContextPayload }>();
const CONTEXT_IN_FLIGHT = new Map<string, Promise<ContextPayload>>();
const CACHE_HEADER_OPEN = "public, max-age=15, s-maxage=45, stale-while-revalidate=90";
const CACHE_HEADER_CLOSED = "public, max-age=60, s-maxage=180, stale-while-revalidate=300";

function parseQueryScore(rawScore: string | null): number | null {
  if (!rawScore) return null;
  const parsed = Number(rawScore);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLive(rawLive: string | null): boolean {
  return rawLive === "1" || rawLive === "true";
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function pruneContextCache(nowMs: number): void {
  for (const [key, entry] of CONTEXT_CACHE.entries()) {
    if (entry.expiresAt <= nowMs) {
      CONTEXT_CACHE.delete(key);
    }
  }
}

function shuffleInPlace<T>(items: T[]): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = out[index];
    out[index] = out[swapIndex];
    out[swapIndex] = current;
  }
  return out;
}

function latestBySymbol(items: PersistedAnalysis[]): PersistedAnalysis[] {
  const bySymbol = new Map<string, PersistedAnalysis>();

  for (const item of items) {
    const existing = bySymbol.get(item.symbol);
    if (!existing) {
      bySymbol.set(item.symbol, item);
      continue;
    }

    const existingTime = new Date(existing.createdAt).getTime();
    const candidateTime = new Date(item.createdAt).getTime();
    if (Number.isFinite(candidateTime) && candidateTime > existingTime) {
      bySymbol.set(item.symbol, item);
    }
  }

  return Array.from(bySymbol.values());
}

function sectorNewsFallbackHeadline(sector: string, sectorEtf: string | null): ContextNewsItem {
  return {
    headline: `${sector} sector headlines`,
    url: sectorEtf ? `https://finance.yahoo.com/quote/${encodeURIComponent(sectorEtf)}/news` : "https://finance.yahoo.com/news/",
    source: "Yahoo Finance",
    publishedAt: null
  };
}

function fetchSectorFallbackNews(sector: string): ContextNewsItem[] {
  const sectorDefinition = GICS_SECTORS.find((item) => item.sector === sector) ?? null;
  return [sectorNewsFallbackHeadline(sector, sectorDefinition?.etf ?? null)];
}

function isGenericFallbackHeadline(item: ContextNewsItem): boolean {
  const normalized = item.headline.trim().toLowerCase();
  return normalized.endsWith("sector headlines") || normalized === "market headlines";
}

async function refreshAnalysisScore(
  symbol: string,
  fallback: PersistedAnalysis | null,
  liveMode: boolean,
  userId: string | null,
  snapshotAnalysis: PersistedAnalysis | null
): Promise<PersistedAnalysis | null> {
  if (snapshotAnalysis) {
    return snapshotAnalysis;
  }

  const cacheMinutes = liveMode ? 1 : 15;

  const cached = await getCachedAnalysis(symbol, cacheMinutes, userId);
  if (cached) return cached;
  if (fallback) return fallback;
  return getCachedAnalysis(symbol, 60 * 24, userId);
}

async function buildContextPayload(options: BuildContextPayloadOptions): Promise<ContextPayload> {
  const [snapshotRead, cachedAnalysis, recentAnalyses, watchlist] = await Promise.all([
    getSnapshotForRead({
      symbol: options.symbol,
      priority: options.liveMode ? "hot" : "watchlist",
      reason: "api-context",
      requestedBy: options.userId
    }),
    getCachedAnalysis(options.symbol, 60 * 24, options.userId),
    getRecentAnalyses(500, options.userId),
    options.userId ? getWatchlist(options.userId) : Promise.resolve([])
  ]);

  const directoryEntry = options.directoryMap[options.symbol] ?? null;
  const snapshotAnalysis = snapshotRead.snapshot?.modules.analysis.data ?? null;
  const sector = resolveSectorFromCandidates([snapshotAnalysis?.sector, cachedAnalysis?.sector, directoryEntry?.sector]);

  const allAnalyses = latestBySymbol([
    ...recentAnalyses,
    ...watchlist
      .map((item) => item.latest)
      .filter((item): item is PersistedAnalysis => Boolean(item))
  ]).filter((item) => options.symbolUniverse.has(item.symbol));
  const currentFallback = snapshotAnalysis ?? cachedAnalysis ?? allAnalyses.find((item) => item.symbol === options.symbol) ?? null;
  const currentLive = await refreshAnalysisScore(options.symbol, currentFallback, options.liveMode, options.userId, snapshotAnalysis);

  const sectorAnalyses = allAnalyses.filter((item) => resolveSectorFromCandidates([item.sector]) === sector);
  const comparableSectorAnalyses = sectorAnalyses.filter((item) => item.symbol !== options.symbol);
  const rankedComparable = [...comparableSectorAnalyses].sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));

  const sameSectorDirectory = Object.values(options.directoryMap)
    .filter((entry) => entry.symbol !== options.symbol && resolveSectorFromCandidates([entry.sector]) === sector)
    .map((entry) => ({
      symbol: entry.symbol,
      companyName: entry.companyName
    }));

  const similarCandidates: ContextSimilarStock[] = [];
  const seenSymbols = new Set<string>();
  const pushSimilar = (symbol: string, companyName: string): void => {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized || normalized === options.symbol || seenSymbols.has(normalized)) return;
    seenSymbols.add(normalized);
    similarCandidates.push({ symbol: normalized, companyName });
  };

  for (const candidate of shuffleInPlace(sameSectorDirectory)) {
    pushSimilar(candidate.symbol, candidate.companyName);
    if (similarCandidates.length >= 6) break;
  }

  if (similarCandidates.length < 6) {
    for (const entry of rankedComparable) {
      const directoryName = options.directoryMap[entry.symbol]?.companyName ?? entry.companyName;
      pushSimilar(entry.symbol, directoryName);
      if (similarCandidates.length >= 6) break;
    }
  }

  if (similarCandidates.length < 6) {
    const rankedUniverse = [...allAnalyses].sort((left, right) => right.score - left.score);
    for (const entry of rankedUniverse) {
      const directoryName = options.directoryMap[entry.symbol]?.companyName ?? entry.companyName;
      pushSimilar(entry.symbol, directoryName);
      if (similarCandidates.length >= 6) break;
    }
  }

  if (similarCandidates.length < 6) {
    const directoryFallback = Object.values(options.directoryMap)
      .sort((left, right) => left.symbol.localeCompare(right.symbol));
    for (const entry of directoryFallback) {
      pushSimilar(entry.symbol, entry.companyName);
      if (similarCandidates.length >= 6) break;
    }
  }

  const similarStocks: ContextSimilarStock[] = similarCandidates.slice(0, 6);

  const scoringBaseline = rankedComparable.map((item) => item.score);
  if (currentLive && resolveSectorFromCandidates([currentLive.sector]) === sector) {
    scoringBaseline.push(currentLive.score);
  }
  if (scoringBaseline.length === 0) {
    scoringBaseline.push(...sectorAnalyses.map((item) => item.score));
  }

  const sectorAverageScore =
    scoringBaseline.length > 0 ? round1(scoringBaseline.reduce((sum, value) => sum + value, 0) / scoringBaseline.length) : null;

  const resolvedCurrentScore = options.queryScore ?? currentLive?.score ?? currentFallback?.score ?? null;

  const vsSectorPercent =
    sectorAverageScore !== null && resolvedCurrentScore !== null && sectorAverageScore > 0
      ? round1(((resolvedCurrentScore - sectorAverageScore) / sectorAverageScore) * 100)
      : null;

  let news: ContextNewsItem[] = (snapshotRead.snapshot?.modules.news.data ?? []).map((item) => ({
    headline: item.headline,
    url: item.url,
    source: item.source,
    publishedAt: item.publishedAt
  }));
  if (news.length === 0 || news.every(isGenericFallbackHeadline)) {
    news = fetchSectorFallbackNews(sector);
  }

  return {
    symbol: options.symbol,
    sector,
    sectorAverageScore,
    vsSectorPercent,
    similarStocks,
    news
  };
}

export async function getContextPayload(options: GetContextPayloadOptions): Promise<ContextServiceResult> {
  const rawSymbol = sanitizeSymbol(options.rawSymbol ?? "");
  const queryScore = parseQueryScore(options.queryScoreRaw);
  const liveMode = parseLive(options.liveRaw);

  if (!rawSymbol) {
    return {
      ok: false,
      status: 400,
      error: "Missing symbol query parameter.",
      cacheControl: "no-store",
      cache: "error"
    };
  }

  const directoryMap = await fetchSP500Directory();
  const symbolUniverse = buildSp500SymbolUniverse(directoryMap);
  const symbol = resolveSp500DirectorySymbol(rawSymbol, directoryMap);
  if (!symbol) {
    return {
      ok: false,
      status: 400,
      error: "ELDAR currently supports S&P 500 symbols only.",
      cacheControl: "no-store",
      cache: "error"
    };
  }

  const cacheKey = `${options.userId ?? "anon"}:${symbol}:${liveMode ? "1" : "0"}:${queryScore === null ? "na" : queryScore.toFixed(2)}`;
  const nowMs = Date.now();
  pruneContextCache(nowMs);
  const cached = CONTEXT_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) {
    const cacheControl = liveMode && isNySessionOpen() ? CACHE_HEADER_OPEN : CACHE_HEADER_CLOSED;
    return {
      ok: true,
      status: 200,
      payload: cached.payload,
      cacheControl,
      cache: "memory"
    };
  }

  try {
    let inFlight = CONTEXT_IN_FLIGHT.get(cacheKey);
    const hadInFlight = Boolean(inFlight);
    if (!inFlight) {
      inFlight = buildContextPayload({
        symbol,
        queryScore,
        liveMode,
        userId: options.userId,
        directoryMap,
        symbolUniverse
      }).finally(() => {
        CONTEXT_IN_FLIGHT.delete(cacheKey);
      });
      CONTEXT_IN_FLIGHT.set(cacheKey, inFlight);
    }

    const payload = await inFlight;
    const liveOpen = liveMode && isNySessionOpen();
    CONTEXT_CACHE.set(cacheKey, {
      expiresAt: Date.now() + (liveOpen ? 45_000 : 180_000),
      payload
    });

    return {
      ok: true,
      status: 200,
      payload,
      cacheControl: liveOpen ? CACHE_HEADER_OPEN : CACHE_HEADER_CLOSED,
      cache: hadInFlight ? "in-flight" : "computed"
    };
  } catch (error) {
    log({
      level: "error",
      service: "context-service",
      message: "Context payload build failed",
      symbol,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      ok: false,
      status: 500,
      error: "Failed to fetch context.",
      cacheControl: "no-store",
      cache: "error"
    };
  }
}
