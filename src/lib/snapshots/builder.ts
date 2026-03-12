import { analyzeStock } from "@/lib/analyze";
import { withTimeoutFallback } from "@/lib/async/timeout";
import { getCompanyFinancials } from "@/lib/financials/eldar-financials-pipeline";
import { GICS_SECTORS } from "@/lib/market/universe/gics-sectors";
import { fetchFinnhubCompanyNews } from "@/lib/market/providers/finnhub";
import { fetchGoogleNewsByQuery } from "@/lib/market/providers/google-news";
import { fetchSP500Directory } from "@/lib/market/universe/sp500";
import { resolveSectorFromCandidates } from "@/lib/scoring/sector/config";
import { getCachedAnalysis, getRecentAnalyses, saveAnalysis } from "@/lib/storage/index";

import {
  acquireTickerBuildLock,
  consumeProviderBudget,
  releaseTickerBuildLock
} from "@/lib/snapshots/coordination";
import {
  FRESHNESS_CLASS_TTL_MS,
  SNAPSHOT_BUILDER_VERSION,
  SYMBOL_SNAPSHOT_SCHEMA_VERSION,
  type SnapshotContextModule,
  type SnapshotFundamentalsModule,
  type SnapshotModuleEnvelope,
  type SnapshotModuleState,
  type SnapshotNewsItem,
  type SymbolSnapshotContract
} from "@/lib/snapshots/contracts";
import type { PersistedAnalysis } from "@/lib/types";

function readIntEnv(key: string, fallback: number): number {
  const parsed = Number.parseInt(String(process.env[key] ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const SNAPSHOT_LOCK_TTL_MS = readIntEnv("SNAPSHOT_LOCK_TTL_MS", 90_000);
const SNAPSHOT_MARKET_BUDGET_PER_MIN = readIntEnv("SNAPSHOT_MARKET_BUDGET_PER_MIN", 1_800);
const SNAPSHOT_SEC_BUDGET_PER_MIN = readIntEnv("SNAPSHOT_SEC_BUDGET_PER_MIN", 360);
const NEWS_FETCH_TIMEOUT_MS = readIntEnv("SNAPSHOT_NEWS_TIMEOUT_MS", 1_500);

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function nowIso(): string {
  return new Date().toISOString();
}

function expiryFromBuiltAt(builtAtIso: string, ttlMs: number): string {
  const baseMs = Date.parse(builtAtIso);
  const start = Number.isFinite(baseMs) ? baseMs : Date.now();
  return new Date(start + ttlMs).toISOString();
}

function moduleState(
  freshnessClass: SnapshotModuleState["freshnessClass"],
  source: string,
  builtAt: string,
  warnings: string[]
): SnapshotModuleState {
  return {
    freshnessClass,
    source,
    builtAt,
    expiresAt: expiryFromBuiltAt(builtAt, FRESHNESS_CLASS_TTL_MS[freshnessClass]),
    warnings
  };
}

function isModuleStale(state: SnapshotModuleState): boolean {
  const expiresMs = Date.parse(state.expiresAt);
  if (!Number.isFinite(expiresMs)) return true;
  return expiresMs <= Date.now();
}

function sectorNewsFallback(sector: string): SnapshotNewsItem[] {
  const etf = GICS_SECTORS.find((item) => item.sector === sector)?.etf ?? null;
  return [
    {
      headline: `${sector} sector headlines`,
      url: etf ? `https://finance.yahoo.com/quote/${encodeURIComponent(etf)}/news` : "https://finance.yahoo.com/news/",
      source: "Yahoo Finance",
      publishedAt: null
    }
  ];
}

function mapGoogleNewsToSnapshotItems(
  items: Awaited<ReturnType<typeof fetchGoogleNewsByQuery>>
): SnapshotNewsItem[] {
  return items
    .map((item) => ({
      headline: item.headline,
      url: item.url,
      source: item.source,
      publishedAt: item.publishedAt
    }))
    .filter((item) => item.headline.trim().length > 0);
}

async function fetchNewsFallbackChain(symbol: string, sector: string): Promise<SnapshotNewsItem[]> {
  const stockNews = mapGoogleNewsToSnapshotItems(await fetchGoogleNewsByQuery(`${symbol} stock`, [symbol], 6));
  if (stockNews.length > 0) return stockNews;

  const sectorNews = mapGoogleNewsToSnapshotItems(await fetchGoogleNewsByQuery(`${sector} sector stocks`, [symbol], 6));
  if (sectorNews.length > 0) return sectorNews;

  const marketNews = mapGoogleNewsToSnapshotItems(await fetchGoogleNewsByQuery("S&P 500 market", [symbol], 6));
  if (marketNews.length > 0) return marketNews;

  return sectorNewsFallback(sector);
}

async function buildAnalysisEnvelope(symbol: string, warnings: string[]): Promise<SnapshotModuleEnvelope<PersistedAnalysis>> {
  const budget = await consumeProviderBudget("market", SNAPSHOT_MARKET_BUDGET_PER_MIN);
  let persisted: PersistedAnalysis | null = null;
  let source = "analysis-cache";

  if (budget.allowed) {
    try {
      const analysis = await analyzeStock(symbol);
      persisted = await saveAnalysis(analysis, null);
      source = "analysis-live";
    } catch (error) {
      warnings.push(`analysis build failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    warnings.push(`analysis budget exceeded for current minute (used=${budget.used ?? "n/a"})`);
  }

  if (!persisted) {
    persisted = await getCachedAnalysis(symbol, 60 * 24, null);
  }

  const builtAt = persisted?.createdAt ?? nowIso();
  return {
    state: moduleState("MARKET_INTRADAY", source, builtAt, []),
    data: persisted
  };
}

async function buildFundamentalsEnvelope(symbol: string, warnings: string[]): Promise<SnapshotModuleEnvelope<SnapshotFundamentalsModule>> {
  const budget = await consumeProviderBudget("sec", SNAPSHOT_SEC_BUDGET_PER_MIN);
  let source = "financials-cache";

  if (!budget.allowed) {
    warnings.push(`sec budget exceeded for current minute (used=${budget.used ?? "n/a"})`);
  }

  try {
    const financials = await getCompanyFinancials(symbol);
    source = "sec-canonical";
    const latestPeriodEnd = financials.income.at(-1)?.periodEnd ?? null;
    const fundamentals: SnapshotFundamentalsModule = {
      cik: financials.cik,
      sector: financials.profile.sector,
      confidence: financials.confidence,
      warningsCount: financials.warnings.length,
      imputedCount: financials.imputedFields.length,
      latestPeriodEnd,
      pricesSource: financials.quality.pricesSource,
      asOf: financials.asOf
    };
    return {
      state: moduleState("FUNDAMENTALS_DAILY", source, financials.asOf, []),
      data: fundamentals
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`fundamentals unavailable: ${message}`);
    return {
      state: moduleState("FUNDAMENTALS_DAILY", source, nowIso(), [message]),
      data: null
    };
  }
}

async function buildContextEnvelope(
  symbol: string,
  analysis: PersistedAnalysis | null
): Promise<SnapshotModuleEnvelope<SnapshotContextModule>> {
  const directory = await fetchSP500Directory();
  const entry = directory[symbol];
  const sector = resolveSectorFromCandidates([analysis?.sector, entry?.sector]);
  const recent = await getRecentAnalyses(500, null);
  const sameSectorScores = recent
    .filter((item) => resolveSectorFromCandidates([item.sector]) === sector)
    .map((item) => item.score);
  const sectorAverageScore =
    sameSectorScores.length > 0 ? Math.round((sameSectorScores.reduce((sum, value) => sum + value, 0) / sameSectorScores.length) * 10) / 10 : null;

  const similarStocks = Object.values(directory)
    .filter((item) => item.symbol !== symbol && resolveSectorFromCandidates([item.sector]) === sector)
    .slice(0, 6)
    .map((item) => ({
      symbol: item.symbol,
      companyName: item.companyName
    }));

  return {
    state: moduleState("ANALYTICS_SCHEDULED", "derived-context", nowIso(), []),
    data: {
      sector,
      sectorAverageScore,
      similarStocks
    }
  };
}

async function buildNewsEnvelope(symbol: string, sector: string): Promise<SnapshotModuleEnvelope<SnapshotNewsItem[]>> {
  const budget = await consumeProviderBudget("market-news", SNAPSHOT_MARKET_BUDGET_PER_MIN);
  if (!budget.allowed) {
    const fallbackNews = await fetchNewsFallbackChain(symbol, sector);
    return {
      state: moduleState("MARKET_INTRADAY", "news-fallback", nowIso(), [
        `news budget exceeded for current minute (used=${budget.used ?? "n/a"})`
      ]),
      data: fallbackNews
    };
  }

  const items = await withTimeoutFallback(fetchFinnhubCompanyNews(symbol, 21, 6), NEWS_FETCH_TIMEOUT_MS, []);
  if (items.length === 0) {
    const fallbackNews = await fetchNewsFallbackChain(symbol, sector);
    return {
      state: moduleState("MARKET_INTRADAY", "google-news-fallback", nowIso(), []),
      data: fallbackNews
    };
  }

  return {
    state: moduleState("MARKET_INTRADAY", "finnhub-news", nowIso(), []),
    data: items.map((item) => ({
      headline: item.headline,
      url: item.url,
      source: item.source,
      publishedAt: item.datetime ? new Date(item.datetime * 1_000).toISOString() : null
    }))
  };
}

export interface BuildSymbolSnapshotOptions {
  workerId: string;
  jobId: string | null;
}

export async function buildSymbolSnapshot(symbol: string, options: BuildSymbolSnapshotOptions): Promise<SymbolSnapshotContract> {
  const normalized = normalizeSymbol(symbol);
  const startedAtMs = Date.now();
  const lock = await acquireTickerBuildLock(normalized, SNAPSHOT_LOCK_TTL_MS);
  if (!lock.acquired) {
    throw new Error(`Snapshot lock is already held for ${normalized}`);
  }

  try {
    const warnings: string[] = [];
    const analysis = await buildAnalysisEnvelope(normalized, warnings);
    const fundamentals = await buildFundamentalsEnvelope(normalized, warnings);
    const context = await buildContextEnvelope(normalized, analysis.data);
    const news = await buildNewsEnvelope(normalized, context.data?.sector ?? "Unknown");

    const staleModules: string[] = [];
    if (isModuleStale(analysis.state)) staleModules.push("analysis");
    if (isModuleStale(fundamentals.state)) staleModules.push("fundamentals");
    if (isModuleStale(context.state)) staleModules.push("context");
    if (isModuleStale(news.state)) staleModules.push("news");

    const dataState =
      staleModules.length === 0
        ? "fresh"
        : staleModules.length >= 3 || !analysis.data
          ? "degraded"
          : "stale";

    return {
      schemaVersion: SYMBOL_SNAPSHOT_SCHEMA_VERSION,
      builderVersion: SNAPSHOT_BUILDER_VERSION,
      symbol: normalized,
      asOf: nowIso(),
      modules: {
        analysis,
        fundamentals,
        context,
        news
      },
      quality: {
        dataState,
        staleModules,
        warnings
      },
      trace: {
        lastJobId: options.jobId,
        lastBuildMs: Date.now() - startedAtMs,
        builtBy: options.workerId
      }
    };
  } finally {
    await releaseTickerBuildLock(normalized, lock.token);
  }
}
