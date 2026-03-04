import {
  fetchAlphaVantageDailyHistory,
  fetchAlphaVantageFallbackData,
  fetchAlphaVantageQuoteSnapshot
} from "@/lib/market/alpha-vantage";
import { fetchEodhdFallbackData, fetchEodhdQuoteSnapshot } from "@/lib/market/eodhd";
import { fetchFmpFallbackData, fetchFmpQuoteSnapshot } from "@/lib/market/fmp";
import {
  fetchFinnhubLatestEarnings,
  fetchFinnhubInsiderSignal,
  fetchFinnhubMetrics,
  fetchFinnhubOptionFlow,
  fetchFinnhubQuoteSnapshot,
  fetchFinnhubSentiment,
  fetchFinnhubCompanyProfile
} from "@/lib/market/finnhub";
import { extractFinnhubMetrics } from "@/lib/market/finnhub-metrics";
import { fetchMassiveOptionFlow, fetchMassiveQuoteSnapshot, fetchMassiveShortInterest } from "@/lib/market/massive";
import { mergePriceObservations } from "@/lib/market/price-merge";
import { rsi, sma } from "@/lib/market/indicators";
import { fetchMacroSignals } from "@/lib/market/macro";
import { fetchSP500Directory } from "@/lib/market/sp500";
import { getLastKnownPrice } from "@/lib/storage";
import type { MarketSnapshot } from "@/lib/types";
import { resolveSectorFromCandidates } from "@/lib/scoring/sector-config";
import { normalizeRatio, safeNumber } from "@/lib/utils";

interface UpgradeHistoryEntry {
  action?: string;
  epochGradeDate?: number;
}

interface HistoryPoint {
  date: Date;
  close: number | null;
}

interface YahooChartResponse {
  chart?: {
    error?: {
      description?: string;
    } | null;
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
  };
}

const SECTOR_ETF_MAP: Record<string, string> = {
  "Information Technology": "XLK",
  Financials: "XLF",
  "Health Care": "XLV",
  "Consumer Discretionary": "XLY",
  "Communication Services": "XLC",
  Industrials: "XLI",
  "Consumer Staples": "XLP",
  Energy: "XLE",
  Utilities: "XLU",
  "Real Estate": "XLRE",
  Materials: "XLB"
};

const COMMODITY_SYMBOL_BY_SECTOR: Record<string, string> = {
  Energy: "CL=F",
  Materials: "HG=F"
};

export interface YahooQuoteSnapshot {
  price: number | null;
  asOfMs: number | null;
}

/**
 * Extracts finite close prices from history rows.
 *
 * @param history Historical rows with nullable close values.
 * @returns Dense numeric close series.
 */
function filterCloses(history: HistoryPoint[]): number[] {
  return history
    .map((item) => item.close)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function trailingReturn(closes: number[], lookback: number): number | null {
  if (closes.length <= lookback) return null;
  const latest = closes[closes.length - 1];
  const base = closes[closes.length - 1 - lookback];
  if (!Number.isFinite(latest) || !Number.isFinite(base) || base <= 0) return null;
  return latest / base - 1;
}

function rollingZScore(closes: number[], window: number): number | null {
  if (closes.length < window) return null;
  const slice = closes.slice(-window);
  if (slice.length === 0) return null;

  const mean = slice.reduce((sum, value) => sum + value, 0) / slice.length;
  const variance = slice.reduce((sum, value) => sum + (value - mean) ** 2, 0) / slice.length;
  const std = Math.sqrt(variance);
  if (!Number.isFinite(std) || std <= 0) return null;

  const latest = closes[closes.length - 1];
  return (latest - mean) / std;
}

/**
 * Collapses daily history to one row per month using the latest day in each month.
 *
 * @param history Daily history rows.
 * @returns Chronological monthly history approximation.
 */
function toMonthlyHistory(history: HistoryPoint[]): HistoryPoint[] {
  const buckets = new Map<string, HistoryPoint>();

  for (const row of history) {
    if (row.close === null) continue;

    const year = row.date.getUTCFullYear();
    const month = row.date.getUTCMonth() + 1;
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const existing = buckets.get(key);

    if (!existing || row.date > existing.date) {
      buckets.set(key, row);
    }
  }

  return Array.from(buckets.values()).sort((a, b) => +a.date - +b.date);
}

/**
 * Counts upgrade/downgrade actions over the trailing 90-day window.
 *
 * @param history Analyst revision history rows.
 * @returns Upgrade and downgrade counts.
 */
function countRevisions(history: UpgradeHistoryEntry[]): { upgrades90d: number; downgrades90d: number } {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  let upgrades90d = 0;
  let downgrades90d = 0;

  for (const row of history) {
    const action = (row.action ?? "").toLowerCase();
    const epoch = row.epochGradeDate ?? 0;

    if (epoch * 1000 < cutoff) continue;

    if (action.includes("up")) {
      upgrades90d += 1;
      continue;
    }

    if (action.includes("down")) {
      downgrades90d += 1;
    }
  }

  return { upgrades90d, downgrades90d };
}

/**
 * Extracts numeric values from Yahoo fields that may be plain numbers or { raw } wrappers.
 *
 * @param value Unknown Yahoo field.
 * @returns Finite numeric value or null.
 */
function fromRawNumber(value: unknown): number | null {
  if (typeof value === "number") return safeNumber(value);
  if (typeof value === "object" && value !== null && "raw" in value) {
    return safeNumber((value as { raw?: unknown }).raw);
  }
  return null;
}

/**
 * Extracts string values from Yahoo fields that may be plain strings or { raw } wrappers.
 *
 * @param value Unknown Yahoo field.
 * @returns String value or null.
 */
function fromRawString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "raw" in value) {
    const raw = (value as { raw?: unknown }).raw;
    return typeof raw === "string" ? raw : null;
  }
  return null;
}

/**
 * Extracts and normalizes debt-to-equity ratio from multiple Yahoo modules.
 *
 * @param financialData financialData module record.
 * @param keyStats defaultKeyStatistics module record.
 * @returns Debt-to-equity in decimal form or null.
 */
function extractDebtToEquity(financialData: Record<string, unknown>, keyStats: Record<string, unknown>): number | null {
  const rawDebtToEquity =
    fromRawNumber(financialData.debtToEquity) ??
    safeNumber(financialData.debtToEquity) ??
    fromRawNumber(keyStats.debtToEquity) ??
    safeNumber(keyStats.debtToEquity);

  return normalizeRatio(rawDebtToEquity);
}

/**
 * Indicates whether options-flow structure contains usable values.
 *
 * @param flow Options flow object.
 * @returns True when at least one options field is present.
 */
function hasOptionFlowData(flow: {
  putCallRatio: number | null;
  totalCallVolume: number | null;
  totalPutVolume: number | null;
}): boolean {
  return flow.putCallRatio !== null || flow.totalCallVolume !== null || flow.totalPutVolume !== null;
}

/**
 * Converts raw share/volume fields that may be represented in millions into absolute shares.
 *
 * @param value Raw provider value.
 * @param millionThreshold Values at or below this threshold are treated as "millions".
 * @returns Absolute share count or null.
 */
function normalizeShareUnits(value: number | null, millionThreshold: number): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value <= millionThreshold ? value * 1_000_000 : value;
}

/**
 * Fetches JSON from Yahoo endpoints with a browser-like user-agent.
 *
 * @param url Target Yahoo endpoint.
 * @returns Parsed JSON payload.
 * @throws Error when response is non-2xx.
 */
async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    },
    next: { revalidate: 300 }
  });

  if (!response.ok) {
    throw new Error(`Yahoo request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

/**
 * Fetches Yahoo quoteSummary payload with selected modules.
 *
 * @param symbol Ticker symbol.
 * @returns First quoteSummary result record or empty object.
 */
async function fetchQuoteSummary(symbol: string): Promise<Record<string, unknown>> {
  const modules = [
    "price",
    "financialData",
    "summaryDetail",
    "defaultKeyStatistics",
    "assetProfile",
    "upgradeDowngradeHistory"
  ].join(",");

  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`;

  try {
    const payload = await fetchJson<{
      quoteSummary?: {
        result?: Array<Record<string, unknown>>;
      };
    }>(url);

    return payload.quoteSummary?.result?.[0] ?? {};
  } catch {
    return {};
  }
}

/**
 * Fetches Yahoo chart history and maps it to internal history points.
 *
 * @param symbol Ticker symbol.
 * @param range Yahoo chart range.
 * @param interval Yahoo chart interval.
 * @returns Parsed chronological history points.
 */
async function fetchChartHistory(symbol: string, range: string, interval: string): Promise<HistoryPoint[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const payload = await fetchJson<YahooChartResponse>(url);
  const chartError = payload.chart?.error?.description;

  if (chartError) {
    throw new Error(chartError);
  }

  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];

  const output: HistoryPoint[] = [];

  for (let i = 0; i < Math.min(timestamps.length, closes.length); i += 1) {
    const ts = timestamps[i];
    const close = closes[i] ?? null;

    if (!Number.isFinite(ts)) continue;

    output.push({
      date: new Date(ts * 1000),
      close: typeof close === "number" && Number.isFinite(close) ? close : null
    });
  }

  return output;
}

/**
 * Fetches latest quote price derived from Yahoo chart data.
 *
 * @param symbol Ticker symbol.
 * @returns Latest close value or null.
 */
export async function fetchYahooQuotePrice(symbol: string): Promise<number | null> {
  const snapshot = await fetchYahooQuoteSnapshot(symbol);
  return snapshot.price;
}

/**
 * Fetches Yahoo quote snapshot using recent daily chart history.
 *
 * @param symbol Ticker symbol.
 * @returns Price plus timestamp of latest close.
 */
export async function fetchYahooQuoteSnapshot(symbol: string): Promise<YahooQuoteSnapshot> {
  try {
    const history = await fetchChartHistory(symbol, "5d", "1d");
    const lastPoint = [...history].reverse().find((row) => row.close !== null) ?? null;
    if (!lastPoint || lastPoint.close === null) {
      return { price: null, asOfMs: null };
    }

    return {
      price: lastPoint.close,
      asOfMs: lastPoint.date.getTime()
    };
  } catch {
    return { price: null, asOfMs: null };
  }
}

/**
 * Builds the full normalized market snapshot by merging Yahoo with all fallback providers.
 *
 * @param symbol Ticker symbol.
 * @returns Consolidated market snapshot used by the scoring engine.
 */
export async function fetchMarketSnapshot(symbol: string): Promise<MarketSnapshot> {
  const normalizedSymbol = symbol.toUpperCase();

  const [
    summaryResult,
    dailyResult,
    monthlyResult,
    macroResult,
    finnhubMetricsResult,
    finnhubEarningsResult,
    finnhubProfileResult,
    finnhubInsiderResult,
    sp500DirectoryResult
  ] =
    await Promise.allSettled([
      fetchQuoteSummary(normalizedSymbol),
      fetchChartHistory(normalizedSymbol, "2y", "1d"),
      fetchChartHistory(normalizedSymbol, "12y", "1mo"),
      fetchMacroSignals(),
      fetchFinnhubMetrics(normalizedSymbol),
      fetchFinnhubLatestEarnings(normalizedSymbol),
      fetchFinnhubCompanyProfile(normalizedSymbol),
      fetchFinnhubInsiderSignal(normalizedSymbol),
      fetchSP500Directory()
    ]);

  const summary = summaryResult.status === "fulfilled" ? summaryResult.value : {};
  let dailyHistory = dailyResult.status === "fulfilled" ? dailyResult.value : [];
  let monthlyHistory = monthlyResult.status === "fulfilled" ? monthlyResult.value : [];
  const finnhubMetricsPayload = finnhubMetricsResult.status === "fulfilled" ? finnhubMetricsResult.value : null;
  const finnhubMetrics = extractFinnhubMetrics(finnhubMetricsPayload);
  const finnhubEarnings =
    finnhubEarningsResult.status === "fulfilled"
      ? finnhubEarningsResult.value
      : {
          actual: null,
          estimate: null,
          period: null,
          reportDate: null,
          surprisePercent: null
        };

  const finnhubProfile =
    finnhubProfileResult.status === "fulfilled"
      ? finnhubProfileResult.value
      : {
          sector: null,
          industry: null,
          shareOutstanding: null
        };
  const finnhubInsider =
    finnhubInsiderResult.status === "fulfilled"
      ? finnhubInsiderResult.value
      : {
          netChangeShares90d: null,
          buyShares90d: 0,
          sellShares90d: 0,
          transactionCount90d: 0
        };
  const sp500Directory = sp500DirectoryResult.status === "fulfilled" ? sp500DirectoryResult.value : {};
  const canonicalCompanyName =
    typeof sp500Directory[normalizedSymbol]?.companyName === "string" &&
    sp500Directory[normalizedSymbol].companyName.trim().length > 0
      ? sp500Directory[normalizedSymbol].companyName.trim()
      : null;

  const macro =
    macroResult.status === "fulfilled"
      ? macroResult.value
      : {
          fedSignal: "UNKNOWN" as const,
          fedDelta: null,
          fedCutProbability: null,
          fedHoldProbability: null,
          fedHikeProbability: null,
          fedNextMeetingDate: null,
          fedOddsSource: null,
          vixLevel: null,
          marketPutCallRatio: null,
          gdpSurprise: null
        };

  if (dailyHistory.length < 220 || monthlyHistory.length < 110) {
    const avHistory = await fetchAlphaVantageDailyHistory(normalizedSymbol);

    if (dailyHistory.length < 220 && avHistory.length > dailyHistory.length) {
      dailyHistory = avHistory;
    }

    if (monthlyHistory.length < 110 && avHistory.length > 0) {
      monthlyHistory = toMonthlyHistory(avHistory);
    }
  }

  const priceData = (summary.price ?? {}) as Record<string, unknown>;
  const financialData = (summary.financialData ?? {}) as Record<string, unknown>;
  const summaryDetail = (summary.summaryDetail ?? {}) as Record<string, unknown>;
  const keyStats = (summary.defaultKeyStatistics ?? {}) as Record<string, unknown>;
  const profile = (summary.assetProfile ?? {}) as Record<string, unknown>;
  const upgrades = ((summary.upgradeDowngradeHistory as Record<string, unknown>)?.history ?? []) as UpgradeHistoryEntry[];
  const yahooSector =
    fromRawString(profile.sector) ??
    (typeof profile.sector === "string" ? profile.sector : null);
  const yahooIndustry =
    fromRawString(profile.industry) ??
    (typeof profile.industry === "string" ? profile.industry : null);

  const preliminarySector = resolveSectorFromCandidates([
    yahooSector,
    yahooIndustry,
    finnhubProfile.sector,
    finnhubProfile.industry
  ]);

  const yahooSentiment = countRevisions(upgrades);

  const needsOverviewFallback =
    preliminarySector === "Other" ||
    (fromRawNumber(priceData.marketCap) ?? safeNumber(priceData.marketCap)) === null ||
    (fromRawNumber(summaryDetail.forwardPE) ??
      safeNumber(summaryDetail.forwardPE) ??
      fromRawNumber(keyStats.forwardPE) ??
      safeNumber(keyStats.forwardPE)) === null ||
    extractDebtToEquity(financialData, keyStats) === null ||
    normalizeRatio(
      fromRawNumber(financialData.profitMargins) ??
        safeNumber(financialData.profitMargins) ??
        fromRawNumber(keyStats.profitMargins) ??
        safeNumber(keyStats.profitMargins)
    ) === null ||
    (fromRawNumber(financialData.revenueGrowth) ?? safeNumber(financialData.revenueGrowth)) === null ||
    (fromRawNumber(financialData.freeCashflow) ?? safeNumber(financialData.freeCashflow)) === null;

  const needsSentimentFallback = yahooSentiment.upgrades90d + yahooSentiment.downgrades90d === 0;

  const [
    avFallback,
    fmpFallback,
    eodhdFallback,
    finnhubSentiment,
    massiveOptionFlow,
    massiveShortInterest,
    finnhubOptionFlow,
    finnhubQuote,
    alphaQuote,
    fmpQuote,
    eodhdQuote,
    massiveQuote
  ] =
    await Promise.all([
    needsOverviewFallback || needsSentimentFallback
      ? fetchAlphaVantageFallbackData(normalizedSymbol)
      : Promise.resolve({
          companyName: null,
          sector: null,
          industry: null,
          currency: null,
          marketCap: null,
          forwardPE: null,
          debtToEquity: null,
          profitMargin: null,
          revenueGrowth: null,
          operatingCashflow: null,
          bullishNewsCount: 0,
          bearishNewsCount: 0
        }),
    needsOverviewFallback || needsSentimentFallback
      ? fetchFmpFallbackData(normalizedSymbol)
      : Promise.resolve({
          companyName: null,
          sector: null,
          industry: null,
          currency: null,
          marketCap: null,
          currentPrice: null,
          forwardPE: null,
          debtToEquity: null,
          profitMargin: null,
          revenueGrowth: null,
          articleCount: 0
        }),
    fetchEodhdFallbackData(normalizedSymbol),
    fetchFinnhubSentiment(normalizedSymbol),
    fetchMassiveOptionFlow(normalizedSymbol),
    fetchMassiveShortInterest(normalizedSymbol),
    fetchFinnhubOptionFlow(normalizedSymbol),
    fetchFinnhubQuoteSnapshot(normalizedSymbol),
    fetchAlphaVantageQuoteSnapshot(normalizedSymbol),
    fetchFmpQuoteSnapshot(normalizedSymbol),
    fetchEodhdQuoteSnapshot(normalizedSymbol),
    fetchMassiveQuoteSnapshot(normalizedSymbol)
  ]);

  const resolvedSector = resolveSectorFromCandidates([
    eodhdFallback.sector,
    yahooSector,
    fmpFallback.sector,
    avFallback.sector,
    finnhubProfile.sector,
    eodhdFallback.industry,
    yahooIndustry,
    fmpFallback.industry,
    avFallback.industry,
    finnhubProfile.industry
  ]);

  if (process.env.ELDAR_DEBUG_SECTOR === "1") {
    console.log(
      `[SECTOR] ${normalizedSymbol} raw=${JSON.stringify({
        yahooSector,
        yahooIndustry,
        avSector: avFallback.sector,
        avIndustry: avFallback.industry,
        fmpSector: fmpFallback.sector,
        fmpIndustry: fmpFallback.industry,
        eodhdSector: eodhdFallback.sector,
        eodhdIndustry: eodhdFallback.industry,
        finnhubSector: finnhubProfile.sector,
        finnhubIndustry: finnhubProfile.industry
      })} final=${resolvedSector}`
    );
  }

  const optionFlow = hasOptionFlowData(massiveOptionFlow)
    ? massiveOptionFlow
    : hasOptionFlowData(finnhubOptionFlow)
      ? finnhubOptionFlow
      : macro.marketPutCallRatio !== null
        ? {
            putCallRatio: macro.marketPutCallRatio,
            totalCallVolume: null,
            totalPutVolume: null,
            source: "CBOE_MARKET_PCR"
          }
        : {
            putCallRatio: 1.0,
            totalCallVolume: null,
            totalPutVolume: null,
            source: "FALLBACK_NEUTRAL"
          };

  const yahooQuotePrice =
    fromRawNumber(priceData.regularMarketPrice) ??
    safeNumber(priceData.regularMarketPrice) ??
    fromRawNumber(financialData.currentPrice) ??
    safeNumber(financialData.currentPrice);
  const rawYahooQuoteTime = fromRawNumber(priceData.regularMarketTime) ?? safeNumber(priceData.regularMarketTime);
  const yahooQuoteTimestampMs =
    rawYahooQuoteTime !== null && rawYahooQuoteTime > 0
      ? rawYahooQuoteTime > 1e12
        ? Math.round(rawYahooQuoteTime)
        : Math.round(rawYahooQuoteTime * 1000)
      : null;

  const lastKnownGoodPrice = await getLastKnownPrice(normalizedSymbol);

  const mergedPrice = mergePriceObservations({
    symbol: normalizedSymbol,
    lastKnownGoodPrice,
    observations: [
      {
        source: "EODHD",
        price: eodhdQuote.price ?? eodhdFallback.currentPrice,
        timestampMs: eodhdQuote.asOfMs ?? eodhdFallback.quoteTimestampMs,
        baseWeight: 1.0
      },
      {
        source: "YAHOO",
        price: yahooQuotePrice,
        timestampMs: yahooQuoteTimestampMs,
        baseWeight: 0.9
      },
      {
        source: "FMP",
        price: fmpQuote.price ?? fmpFallback.currentPrice,
        timestampMs: fmpQuote.asOfMs,
        baseWeight: 0.8
      },
      {
        source: "ALPHA_VANTAGE",
        price: alphaQuote.price,
        timestampMs: alphaQuote.asOfMs,
        baseWeight: 0.7
      },
      {
        source: "FINNHUB",
        price: finnhubQuote.price,
        timestampMs: finnhubQuote.asOfMs,
        baseWeight: 0.6
      },
      {
        source: "MASSIVE",
        price: massiveQuote.price,
        timestampMs: massiveQuote.asOfMs,
        baseWeight: 0.5
      }
    ]
  });

  for (const warning of mergedPrice.warnings) {
    console.warn(`[${warning.type}] ${warning.message}`);
  }

  const currentPrice = mergedPrice.value ?? (filterCloses(dailyHistory).at(-1) ?? null);

  if (currentPrice === null) {
    const providerState = [
      `eodhdQuote=${eodhdQuote.price ?? "N/A"}`,
      `eodhdPrice=${eodhdFallback.currentPrice ?? "N/A"}`,
      `yahooPrice=${yahooQuotePrice ?? "N/A"}`,
      `fmpQuote=${fmpQuote.price ?? "N/A"}`,
      `fmpPrice=${fmpFallback.currentPrice ?? "N/A"}`,
      `alphaQuote=${alphaQuote.price ?? "N/A"}`,
      `finnhubQuote=${finnhubQuote.price ?? "N/A"}`,
      `massiveQuote=${massiveQuote.price ?? "N/A"}`,
      `historyPoints=${dailyHistory.length}`
    ].join(", ");

    throw new Error(`No live market data found for symbol: ${normalizedSymbol} (${providerState})`);
  }

  const marketCap =
    eodhdFallback.marketCap ??
    fromRawNumber(priceData.marketCap) ??
    safeNumber(priceData.marketCap) ??
    fmpFallback.marketCap ??
    avFallback.marketCap ??
    finnhubMetrics.marketCap;

  const freeCashflow =
    eodhdFallback.freeCashflow ??
    fromRawNumber(financialData.freeCashflow) ??
    safeNumber(financialData.freeCashflow) ??
    avFallback.operatingCashflow ??
    finnhubMetrics.freeCashflow;

  const revenueGrowth = normalizeRatio(
    eodhdFallback.revenueGrowth ??
    fromRawNumber(financialData.revenueGrowth) ??
      safeNumber(financialData.revenueGrowth) ??
      fmpFallback.revenueGrowth ??
      avFallback.revenueGrowth ??
      finnhubMetrics.revenueGrowth
  );

  const closes = filterCloses(dailyHistory);
  const sma200 = sma(closes, 200);
  const rsi14 = rsi(closes, 14);

  const sectorEtfSymbol = SECTOR_ETF_MAP[resolvedSector] ?? null;
  const commoditySymbol = COMMODITY_SYMBOL_BY_SECTOR[resolvedSector] ?? null;
  const [sectorHistory, commodityHistory] = await Promise.all([
    sectorEtfSymbol ? fetchChartHistory(sectorEtfSymbol, "2y", "1d").catch(() => []) : Promise.resolve([]),
    commoditySymbol ? fetchChartHistory(commoditySymbol, "2y", "1d").catch(() => []) : Promise.resolve([])
  ]);
  const sectorCloses = filterCloses(sectorHistory);
  const commodityCloses = filterCloses(commodityHistory);

  const stockReturn52w = trailingReturn(closes, 252);
  const sectorReturn52w = trailingReturn(sectorCloses, 252);
  const rs52Week =
    stockReturn52w !== null && sectorReturn52w !== null && Number.isFinite(1 + sectorReturn52w) && 1 + sectorReturn52w > 0
      ? (1 + stockReturn52w) / (1 + sectorReturn52w)
      : null;
  const zScore52Week = rollingZScore(closes, 252);
  const priceZScore20d = rollingZScore(closes, 20);
  const commodityMomentum12m = trailingReturn(commodityCloses, 252);

  const fcfYield = freeCashflow !== null && marketCap !== null && marketCap > 0 ? freeCashflow / marketCap : null;

  const forwardPE =
    eodhdFallback.forwardPE ??
    fromRawNumber(summaryDetail.forwardPE) ??
    safeNumber(summaryDetail.forwardPE) ??
    fromRawNumber(keyStats.forwardPE) ??
    safeNumber(keyStats.forwardPE) ??
    fmpFallback.forwardPE ??
    avFallback.forwardPE ??
    finnhubMetrics.forwardPE;

  const earningsQuarterlyGrowth = normalizeRatio(
    fromRawNumber(keyStats.earningsQuarterlyGrowth) ??
      safeNumber(keyStats.earningsQuarterlyGrowth) ??
      fromRawNumber(financialData.earningsGrowth) ??
      safeNumber(financialData.earningsGrowth) ??
      finnhubMetrics.earningsGrowth
  );

  const forwardEps =
    fromRawNumber(keyStats.forwardEps) ??
    safeNumber(keyStats.forwardEps) ??
    fromRawNumber(financialData.forwardEps) ??
    safeNumber(financialData.forwardEps) ??
    finnhubMetrics.forwardEps;

  const trailingEps =
    finnhubEarnings.actual ??
    fromRawNumber(keyStats.trailingEps) ??
    safeNumber(keyStats.trailingEps) ??
    fromRawNumber(financialData.trailingEps) ??
    safeNumber(financialData.trailingEps) ??
    finnhubMetrics.trailingEps;

  const roic = normalizeRatio(
    fromRawNumber(financialData.returnOnInvestedCapital) ??
      safeNumber(financialData.returnOnInvestedCapital) ??
    fromRawNumber(financialData.returnOnEquity) ??
      safeNumber(financialData.returnOnEquity) ??
      fromRawNumber(keyStats.returnOnEquity) ??
      safeNumber(keyStats.returnOnEquity) ??
      finnhubMetrics.roe
  );

  const evEbitda =
    fromRawNumber(financialData.enterpriseToEbitda) ??
    safeNumber(financialData.enterpriseToEbitda) ??
    fromRawNumber(summaryDetail.enterpriseToEbitda) ??
    safeNumber(summaryDetail.enterpriseToEbitda) ??
    fromRawNumber(keyStats.enterpriseToEbitda) ??
    safeNumber(keyStats.enterpriseToEbitda) ??
    finnhubMetrics.evEbitda ??
    null;

  const shortPercentOfFloat = normalizeRatio(
    fromRawNumber(keyStats.shortPercentOfFloat) ??
      safeNumber(keyStats.shortPercentOfFloat) ??
      fromRawNumber(summaryDetail.shortPercentOfFloat) ??
      safeNumber(summaryDetail.shortPercentOfFloat) ??
      finnhubMetrics.shortPercentOfFloat ??
      (massiveShortInterest.shortInterestShares !== null && marketCap !== null && currentPrice > 0
        ? massiveShortInterest.shortInterestShares / (marketCap / currentPrice)
        : null)
  );

  const sharesOutstanding =
    finnhubMetrics.sharesOutstanding ??
    finnhubProfile.shareOutstanding ??
    normalizeShareUnits(
      fromRawNumber(keyStats.sharesOutstanding) ??
        safeNumber(keyStats.sharesOutstanding) ??
        fromRawNumber(summaryDetail.sharesOutstanding) ??
        safeNumber(summaryDetail.sharesOutstanding),
      500_000
    ) ??
    (marketCap !== null && currentPrice > 0 ? marketCap / currentPrice : null);

  const averageDailyVolumeShares =
    finnhubMetrics.avgDailyVolumeShares ??
    normalizeShareUnits(
      fromRawNumber(summaryDetail.averageVolume) ??
        safeNumber(summaryDetail.averageVolume) ??
        fromRawNumber(summaryDetail.averageDailyVolume10Day) ??
        safeNumber(summaryDetail.averageDailyVolume10Day) ??
        fromRawNumber(keyStats.averageDailyVolume10Day) ??
        safeNumber(keyStats.averageDailyVolume10Day),
      2_000
    );

  const shortSharesEstimate =
    massiveShortInterest.shortInterestShares ??
    (shortPercentOfFloat !== null && sharesOutstanding !== null ? shortPercentOfFloat * sharesOutstanding : null);

  const computedDtc =
    shortSharesEstimate !== null && averageDailyVolumeShares !== null && averageDailyVolumeShares > 0
      ? shortSharesEstimate / averageDailyVolumeShares
      : null;

  const dtc =
    finnhubMetrics.dtc ??
    fromRawNumber(keyStats.shortRatio) ??
    safeNumber(keyStats.shortRatio) ??
    fromRawNumber(summaryDetail.shortRatio) ??
    safeNumber(summaryDetail.shortRatio) ??
    computedDtc;

  const rawNetBuyRatio90d =
    finnhubInsider.netChangeShares90d !== null && sharesOutstanding !== null && sharesOutstanding > 0
      ? finnhubInsider.netChangeShares90d / sharesOutstanding
      : null;
  const netBuyRatio90d =
    rawNetBuyRatio90d !== null && Math.abs(rawNetBuyRatio90d) <= 0.25
      ? rawNetBuyRatio90d
      : null;

  const debtToEquity =
    eodhdFallback.debtToEquity ??
    extractDebtToEquity(financialData, keyStats) ??
    fmpFallback.debtToEquity ??
    avFallback.debtToEquity ??
    finnhubMetrics.debtToEquity;

  const totalUpgrades =
    yahooSentiment.upgrades90d +
    avFallback.bullishNewsCount +
    finnhubSentiment.bullishCount;
  const totalDowngrades =
    yahooSentiment.downgrades90d +
    avFallback.bearishNewsCount +
    finnhubSentiment.bearishCount;
  const totalRevisions = totalUpgrades + totalDowngrades;
  const epsRevision30d = totalRevisions > 0 ? (totalUpgrades - totalDowngrades) / totalRevisions : null;

  const providerCompanyName =
    fromRawString(priceData.longName) ??
    (typeof priceData.longName === "string" ? priceData.longName : null) ??
    fromRawString(priceData.shortName) ??
    (typeof priceData.shortName === "string" ? priceData.shortName : null);

  const normalizedProviderCompanyName =
    providerCompanyName && providerCompanyName.trim().length > 0
      ? providerCompanyName.trim()
      : null;

  const resolvedCompanyName =
    canonicalCompanyName ??
    eodhdFallback.companyName ??
    normalizedProviderCompanyName ??
    fmpFallback.companyName ??
    avFallback.companyName ??
    normalizedSymbol;

  return {
    symbol: normalizedSymbol,
    companyName: String(resolvedCompanyName),
    sector: resolvedSector,
    currency: String(
      eodhdFallback.currency ??
      fromRawString(priceData.currency) ??
      priceData.currency ??
      fmpFallback.currency ??
      avFallback.currency ??
      "USD"
    ),
    currentPrice,
    marketCap,
    earningsQuarterlyGrowth,
    forwardEps,
    trailingEps,
    revenueGrowth,
    fcfYield,
    debtToEquity,
    forwardPE,
    roic,
    roicTrend: finnhubMetrics.roicTrend,
    ffoYield: null,
    evEbitda,
    epsRevision30d,
    technical: {
      sma200,
      rs52Week,
      zScore52Week,
      priceZScore20d,
      rsi14,
      dtc
    },
    options: {
      putCallRatio: optionFlow.putCallRatio,
      totalCallVolume: optionFlow.totalCallVolume,
      totalPutVolume: optionFlow.totalPutVolume
    },
    insider: {
      netBuyRatio90d
    },
    shortPercentOfFloat,
    macro: {
      vixLevel: macro.vixLevel,
      commodityMomentum12m
    }
  };
}
