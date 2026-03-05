import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { analyzeStock } from "@/lib/analyze";
import { fetchFinnhubCompanyNews } from "@/lib/market/finnhub";
import { isNySessionOpen } from "@/lib/market/ny-session";
import { fetchSP500Directory } from "@/lib/market/sp500";
import { getTop100Sp500SymbolSet } from "@/lib/market/top100";
import guard, { isGuardBlockedError } from "@/lib/security/guard";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { resolveSectorFromCandidates } from "@/lib/scoring/sector-config";
import { getCachedAnalysis, getRecentAnalyses, getWatchlist, saveAnalysis } from "@/lib/storage";
import type { PersistedAnalysis } from "@/lib/types";
import { sanitizeSymbol } from "@/lib/utils";

export const runtime = "nodejs";

interface ContextSimilarStock {
  symbol: string;
  companyName: string;
}

interface ContextNewsItem {
  headline: string;
  url: string | null;
  source: string | null;
  publishedAt: string | null;
}

interface ContextPayload {
  symbol: string;
  sector: string;
  sectorAverageScore: number | null;
  vsSectorPercent: number | null;
  similarStocks: ContextSimilarStock[];
  news: ContextNewsItem[];
}

const CONTEXT_CACHE = new Map<string, { expiresAt: number; payload: ContextPayload }>();
const CACHE_HEADER_OPEN = "public, max-age=15, s-maxage=45, stale-while-revalidate=90";
const CACHE_HEADER_CLOSED = "public, max-age=60, s-maxage=180, stale-while-revalidate=300";
const DIRECTORY_TIMEOUT_MS = 2_500;
const NEWS_TIMEOUT_MS = 1_500;
const COMPARABLE_REFRESH_TIMEOUT_OPEN_MS = 2_200;
const COMPARABLE_REFRESH_TIMEOUT_CLOSED_MS = 1_200;

function pruneContextCache(nowMs: number): void {
  for (const [key, entry] of CONTEXT_CACHE.entries()) {
    if (entry.expiresAt <= nowMs) {
      CONTEXT_CACHE.delete(key);
    }
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
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

function parseQueryScore(rawScore: string | null): number | null {
  if (!rawScore) return null;
  const parsed = Number(rawScore);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLive(rawLive: string | null): boolean {
  return rawLive === "1" || rawLive === "true";
}

async function withTimeoutFallback<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, timeoutMs);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

async function refreshAnalysisScore(
  symbol: string,
  fallback: PersistedAnalysis | null,
  liveMode: boolean,
  userId: string | null
): Promise<PersistedAnalysis | null> {
  const cacheMinutes = liveMode ? 1 : 15;
  const cached = await getCachedAnalysis(symbol, cacheMinutes, userId);
  if (cached) {
    return cached;
  }

  try {
    const fresh = await analyzeStock(symbol);
    return await saveAnalysis(fresh, userId);
  } catch {
    if (fallback) {
      return fallback;
    }
    return getCachedAnalysis(symbol, 60 * 24, userId);
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    // Shared security gate: protected-route policy + global rolling per-IP limit.
    await guard(request);
  } catch (error) {
    if (isGuardBlockedError(error)) {
      return error.response;
    }
    throw error;
  }

  const { userId } = await auth();

  const throttled = enforceRateLimit(request, {
    bucket: "api-context",
    max: 90,
    windowMs: 60_000
  });
  if (throttled) return throttled;

  const { searchParams } = new URL(request.url);
  const symbol = sanitizeSymbol(searchParams.get("symbol") ?? "");
  const queryScore = parseQueryScore(searchParams.get("score"));
  const liveMode = parseLive(searchParams.get("live"));

  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol query parameter." }, { status: 400 });
  }

  const top100Symbols = getTop100Sp500SymbolSet();

  if (!top100Symbols.has(symbol)) {
    return NextResponse.json({ error: "ELDAR currently supports Top 100 S&P 500 symbols only." }, { status: 400 });
  }

  const cacheKey = `${userId ?? "anon"}:${symbol}:${liveMode ? "1" : "0"}:${queryScore === null ? "na" : queryScore.toFixed(2)}`;
  const nowMs = Date.now();
  pruneContextCache(nowMs);
  const cached = CONTEXT_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) {
    return NextResponse.json(cached.payload, {
      headers: {
        "Cache-Control": liveMode && isNySessionOpen() ? CACHE_HEADER_OPEN : CACHE_HEADER_CLOSED
      }
    });
  }

  try {
    const [cachedAnalysis, directoryMap, recentAnalyses, watchlist, recentNews] = await Promise.all([
      getCachedAnalysis(symbol, 60 * 24, userId ?? null),
      withTimeoutFallback(fetchSP500Directory(), DIRECTORY_TIMEOUT_MS, {} as Awaited<ReturnType<typeof fetchSP500Directory>>),
      getRecentAnalyses(500, userId ?? null),
      userId ? getWatchlist(userId) : Promise.resolve([]),
      withTimeoutFallback(fetchFinnhubCompanyNews(symbol, 21, 6), NEWS_TIMEOUT_MS, [])
    ]);

    const top100DirectoryMap = Object.fromEntries(
      Object.entries(directoryMap).filter(([entrySymbol]) => top100Symbols.has(entrySymbol))
    );

    const directoryEntry = top100DirectoryMap[symbol];
    const sector = resolveSectorFromCandidates([cachedAnalysis?.sector, directoryEntry?.sector]);

    const allAnalyses = latestBySymbol([
      ...recentAnalyses,
      ...watchlist
        .map((item) => item.latest)
        .filter((item): item is PersistedAnalysis => Boolean(item))
    ]).filter((item) => top100Symbols.has(item.symbol));
    const currentFallback = cachedAnalysis ?? allAnalyses.find((item) => item.symbol === symbol) ?? null;
    const currentLive = await refreshAnalysisScore(symbol, currentFallback, liveMode, userId ?? null);

    const sectorAnalyses = allAnalyses.filter((item) => resolveSectorFromCandidates([item.sector]) === sector);
    const comparableSectorAnalyses = sectorAnalyses.filter((item) => item.symbol !== symbol);
    const rankedComparable = [...comparableSectorAnalyses].sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));

    const comparableRefreshTimeout = liveMode ? COMPARABLE_REFRESH_TIMEOUT_OPEN_MS : COMPARABLE_REFRESH_TIMEOUT_CLOSED_MS;
    const refreshedComparable = await Promise.all(
      rankedComparable
        .slice(0, liveMode ? 10 : 6)
        .map((item) =>
          withTimeoutFallback(
            refreshAnalysisScore(item.symbol, item, liveMode, userId ?? null),
            comparableRefreshTimeout,
            item
          )
        )
    );

    const sameSectorDirectory = Object.values(top100DirectoryMap)
      .filter((entry) => entry.symbol !== symbol && resolveSectorFromCandidates([entry.sector]) === sector)
      .map((entry) => ({
        symbol: entry.symbol,
        companyName: entry.companyName
      }));

    const randomSimilar = shuffleInPlace(sameSectorDirectory).slice(0, 6);
    const similarStocks: ContextSimilarStock[] = randomSimilar;

    const scoringBaseline = refreshedComparable
      .filter((item): item is PersistedAnalysis => item !== null)
      .map((item) => item.score);
    if (currentLive && resolveSectorFromCandidates([currentLive.sector]) === sector) {
      scoringBaseline.push(currentLive.score);
    }
    if (scoringBaseline.length === 0) {
      scoringBaseline.push(...sectorAnalyses.map((item) => item.score));
    }

    const sectorAverageScore =
      scoringBaseline.length > 0 ? round1(scoringBaseline.reduce((sum, value) => sum + value, 0) / scoringBaseline.length) : null;

    const resolvedCurrentScore =
      queryScore ??
      currentLive?.score ??
      currentFallback?.score ??
      null;

    const vsSectorPercent =
      sectorAverageScore !== null && resolvedCurrentScore !== null && sectorAverageScore > 0
        ? round1(((resolvedCurrentScore - sectorAverageScore) / sectorAverageScore) * 100)
        : null;

    const news: ContextNewsItem[] = recentNews.map((item) => ({
      headline: item.headline,
      url: item.url,
      source: item.source,
      publishedAt: item.datetime ? new Date(item.datetime * 1000).toISOString() : null
    }));

    const payload: ContextPayload = {
      symbol,
      sector,
      sectorAverageScore,
      vsSectorPercent,
      similarStocks,
      news
    };

    const liveOpen = liveMode && isNySessionOpen();
    CONTEXT_CACHE.set(cacheKey, {
      expiresAt: Date.now() + (liveOpen ? 45_000 : 180_000),
      payload
    });

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": liveOpen ? CACHE_HEADER_OPEN : CACHE_HEADER_CLOSED
      }
    });
  } catch (error) {
    console.error("/api/context GET error", error);
    return NextResponse.json(
      { error: "Failed to fetch context." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
