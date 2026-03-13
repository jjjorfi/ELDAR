import { fetchAlphaVantageDailyHistory } from "@/lib/market/providers/alpha-vantage";
import { getFetchSignal } from "@/lib/market/adapter-utils";
import { mergePriceObservations } from "@/lib/market/orchestration/price-merge";
import { fetchMarketSnapshotFallbacks, fetchMarketSnapshotSignals } from "@/lib/market/orchestration/market-snapshot-support";
import { rsi, sma } from "@/lib/market/indicators";
import { fetchTemporaryHistoryFallback, fetchTemporaryQuoteFallback } from "@/lib/market/orchestration/temporary-fallbacks";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { getLastKnownPrice } from "@/lib/storage/index";
import type { MarketSnapshot } from "@/lib/types";
import { resolveSectorFromCandidates } from "@/lib/scoring/sector/config";
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
const YAHOO_FETCH_TIMEOUT_MS = 6_000;
const PROVIDER_WARNING_TTL_MS = 60_000;
const YAHOO_QUOTE_SUMMARY_DISABLE_TTL_MS = 10 * 60_000;
const providerWarnings = new Map<string, number>();
let yahooQuoteSummaryDisabledUntil = 0;

export interface YahooQuoteSnapshot {
  price: number | null;
  asOfMs: number | null;
}

function warnProvider(symbol: string, scope: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const key = `${symbol}:${scope}:${message}`;
  const now = Date.now();
  const previous = providerWarnings.get(key) ?? 0;
  if (now - previous < PROVIDER_WARNING_TTL_MS) {
    return;
  }
  providerWarnings.set(key, now);
  log({
    level: "warn",
    service: "provider-yahoo",
    message,
    symbol,
    scope
  });
}

function toYahooSymbol(symbol: string): string {
  return symbol.replace(/\./g, "-");
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
    signal: getFetchSignal(YAHOO_FETCH_TIMEOUT_MS),
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
  if (Date.now() < yahooQuoteSummaryDisabledUntil) {
    return {};
  }

  const modules = [
    "price",
    "financialData",
    "summaryDetail",
    "defaultKeyStatistics",
    "assetProfile",
    "upgradeDowngradeHistory"
  ].join(",");

  const yahooSymbol = toYahooSymbol(symbol);
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yahooSymbol)}?modules=${modules}`;

  try {
    const payload = await fetchJson<{
      quoteSummary?: {
        result?: Array<Record<string, unknown>>;
      };
    }>(url);

    return payload.quoteSummary?.result?.[0] ?? {};
  } catch (error) {
    if (error instanceof Error && (error.message.includes("(401)") || error.message.includes("(403)"))) {
      yahooQuoteSummaryDisabledUntil = Date.now() + YAHOO_QUOTE_SUMMARY_DISABLE_TTL_MS;
    }
    warnProvider(symbol, "quoteSummary", error);
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
  const yahooSymbol = toYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${range}&interval=${interval}`;

  try {
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

    if (output.length > 0) {
      return output;
    }
  } catch (error) {
    warnProvider(symbol, `chart:${range}:${interval}`, error);
  }

  // Temporary patch: free-tier quote/history bridges keep v8 technical factors
  // alive until premium data rates and entitlements are upgraded.
  const fallback = await fetchTemporaryHistoryFallback(symbol, { range, interval });
  if (fallback.points.length > 0) {
    warnProvider(symbol, `chart-fallback:${range}:${interval}`, `using ${fallback.source ?? "temporary source"}`);
    return fallback.points;
  }

  return [];
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
      const fallback = await fetchTemporaryQuoteFallback(symbol);
      return { price: fallback.price, asOfMs: fallback.asOfMs };
    }

    return {
      price: lastPoint.close,
      asOfMs: lastPoint.date.getTime()
    };
  } catch (error) {
    warnProvider(symbol, "quoteSnapshot", error);
    const fallback = await fetchTemporaryQuoteFallback(symbol);
    return { price: fallback.price, asOfMs: fallback.asOfMs };
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
    monthlyResult
  ] =
    await Promise.allSettled([
      fetchQuoteSummary(normalizedSymbol),
      fetchChartHistory(normalizedSymbol, "2y", "1d"),
      fetchChartHistory(normalizedSymbol, "12y", "1mo")
    ]);

  const {
    macro,
    finnhubMetrics,
    finnhubEarnings,
    finnhubProfile,
    finnhubInsider,
    sp500Directory
  } = await fetchMarketSnapshotSignals(normalizedSymbol);

  const summary = summaryResult.status === "fulfilled" ? summaryResult.value : {};
  let dailyHistory = dailyResult.status === "fulfilled" ? dailyResult.value : [];
  let monthlyHistory = monthlyResult.status === "fulfilled" ? monthlyResult.value : [];
  const canonicalCompanyName =
    typeof sp500Directory[normalizedSymbol]?.companyName === "string" &&
    sp500Directory[normalizedSymbol].companyName.trim().length > 0
      ? sp500Directory[normalizedSymbol].companyName.trim()
      : null;
  const canonicalSector =
    typeof sp500Directory[normalizedSymbol]?.sector === "string" &&
    sp500Directory[normalizedSymbol].sector.trim().length > 0
      ? sp500Directory[normalizedSymbol].sector.trim()
      : null;

  if (dailyHistory.length < 220 || monthlyHistory.length < 110) {
    // Temporary patch: these extra free-tier lookups are a build-stage bridge.
    // Remove or demote them once premium history coverage is in place.
    const temporaryHistory = await fetchTemporaryHistoryFallback(normalizedSymbol, {
      range: "2y",
      interval: "1d",
      minimumPoints: 220
    });
    const avHistory = await fetchAlphaVantageDailyHistory(normalizedSymbol);
    const bestFallbackHistory =
      temporaryHistory.points.length >= avHistory.length ? temporaryHistory.points : avHistory;

    if (dailyHistory.length < 220 && bestFallbackHistory.length > dailyHistory.length) {
      dailyHistory = bestFallbackHistory;
    }

    if (monthlyHistory.length < 110 && bestFallbackHistory.length > 0) {
      monthlyHistory = toMonthlyHistory(bestFallbackHistory);
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
    canonicalSector,
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

  const {
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
  } = await fetchMarketSnapshotFallbacks(normalizedSymbol, {
    needsOverviewFallback,
    needsSentimentFallback
  });

  const resolvedSector = resolveSectorFromCandidates([
    canonicalSector,
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

  if (env.NODE_ENV !== "production" && env.ELDAR_DEBUG_SECTOR) {
    log({
      level: "debug",
      service: "yahoo-snapshot",
      message: "Resolved sector candidates",
      symbol: normalizedSymbol,
      resolvedSector,
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
    });
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
    log({
      level: "warn",
      service: "provider-yahoo",
      message: warning.message,
      warningType: warning.type,
      symbol: normalizedSymbol
    });
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
    sectorEtfSymbol
      ? fetchChartHistory(sectorEtfSymbol, "2y", "1d").catch((error) => {
          warnProvider(normalizedSymbol, `sector-history:${sectorEtfSymbol}`, error);
          return [];
        })
      : Promise.resolve([]),
    commoditySymbol
      ? fetchChartHistory(commoditySymbol, "2y", "1d").catch((error) => {
          warnProvider(normalizedSymbol, `commodity-history:${commoditySymbol}`, error);
          return [];
        })
      : Promise.resolve([])
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

  const forwardPEFromEodhd = eodhdFallback.forwardPE;
  const forwardPEFromSummary =
    fromRawNumber(summaryDetail.forwardPE) ??
    safeNumber(summaryDetail.forwardPE) ??
    fromRawNumber(keyStats.forwardPE) ??
    safeNumber(keyStats.forwardPE);
  const forwardPEFromFmp = fmpFallback.forwardPE;
  const forwardPEFromAv = avFallback.forwardPE;
  const forwardPEFromFinnhub = finnhubMetrics.forwardPE;

  // Strict forward valuation policy:
  // - accept forwardPE only when basis is explicitly NTM.
  // - reject generic/trailing/unknown P/E from provider fallbacks.
  const forwardPeCandidates: Array<{ value: number | null; basis: "NTM" | "TTM" | "UNKNOWN" | null }> = [
    { value: forwardPEFromSummary, basis: "NTM" },
    { value: forwardPEFromEodhd, basis: eodhdFallback.forwardPEBasis },
    { value: forwardPEFromFmp, basis: fmpFallback.forwardPEBasis },
    { value: forwardPEFromAv, basis: avFallback.forwardPEBasis },
    { value: forwardPEFromFinnhub, basis: finnhubMetrics.forwardPEBasis }
  ];
  const forwardPeSelected = forwardPeCandidates.find(
    (candidate) => candidate.value !== null && candidate.basis === "NTM"
  );
  const forwardPE = forwardPeSelected?.value ?? null;
  const forwardPEBasis: "NTM" | "TTM" | "UNKNOWN" | null = forwardPeSelected ? "NTM" : null;

  const earningsGrowthFromKeyStats =
    fromRawNumber(keyStats.earningsQuarterlyGrowth) ??
    safeNumber(keyStats.earningsQuarterlyGrowth);
  const earningsGrowthFromFinancialData =
    fromRawNumber(financialData.earningsGrowth) ??
    safeNumber(financialData.earningsGrowth);
  const earningsGrowthFromFinnhub = finnhubMetrics.earningsGrowth;

  const earningsQuarterlyGrowth = normalizeRatio(
    earningsGrowthFromKeyStats ??
    earningsGrowthFromFinancialData ??
    earningsGrowthFromFinnhub
  );

  const earningsGrowthBasis: "YOY" | "QOQ" | "UNKNOWN" | null =
    earningsGrowthFromKeyStats !== null
      ? "YOY"
      : earningsGrowthFromFinancialData !== null
        ? "UNKNOWN"
        : earningsGrowthFromFinnhub !== null
          ? "UNKNOWN"
          : null;

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
    forwardPEBasis,
    roic,
    roicTrend: finnhubMetrics.roicTrend,
    ffoYield: null,
    evEbitda,
    epsRevision30d,
    earningsGrowthBasis,
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
