import {
  fetchAlphaVantageFallbackData,
  fetchAlphaVantageQuoteSnapshot,
  type AlphaVantageFallbackData,
  type AlphaVantageQuoteSnapshot
} from "@/lib/market/providers/alpha-vantage";
import {
  fetchEodhdFallbackData,
  fetchEodhdQuoteSnapshot,
  type EodhdFallbackData,
  type EodhdQuoteSnapshot
} from "@/lib/market/providers/eodhd";
import {
  fetchFinnhubCompanyProfile,
  fetchFinnhubInsiderSignal,
  fetchFinnhubLatestEarnings,
  fetchFinnhubMetrics,
  fetchFinnhubOptionFlow,
  fetchFinnhubQuoteSnapshot,
  fetchFinnhubSentiment,
  type FinnhubCompanyProfile,
  type FinnhubEarningsSnapshot,
  type FinnhubInsiderSignal,
  type FinnhubOptionFlow,
  type FinnhubQuoteSnapshot,
  type FinnhubSentimentSignal
} from "@/lib/market/providers/finnhub";
import { extractFinnhubMetrics, type FinnhubMetrics } from "@/lib/market/providers/finnhub-metrics";
import {
  fetchFmpFallbackData,
  fetchFmpQuoteSnapshot,
  type FmpFallbackData,
  type FmpQuoteSnapshot
} from "@/lib/market/providers/fmp";
import {
  fetchMassiveOptionFlow,
  fetchMassiveQuoteSnapshot,
  fetchMassiveShortInterest,
  type MassiveOptionFlow,
  type MassiveQuoteSnapshot,
  type MassiveShortInterest
} from "@/lib/market/providers/massive";
import { fetchMacroSignals } from "@/lib/market/orchestration/macro";
import { fetchSP500Directory, type SP500DirectoryEntry } from "@/lib/market/universe/sp500";

type MacroSignals = Awaited<ReturnType<typeof fetchMacroSignals>>;
type Sp500Directory = Record<string, SP500DirectoryEntry>;

function emptyMacroSignals(): MacroSignals {
  return {
    fedSignal: "UNKNOWN",
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
}

function emptyFinnhubEarnings(): FinnhubEarningsSnapshot {
  return {
    actual: null,
    estimate: null,
    period: null,
    reportDate: null,
    surprisePercent: null
  };
}

function emptyFinnhubProfile(): FinnhubCompanyProfile {
  return {
    sector: null,
    industry: null,
    shareOutstanding: null
  };
}

function emptyFinnhubInsider(): FinnhubInsiderSignal {
  return {
    netChangeShares90d: null,
    buyShares90d: 0,
    sellShares90d: 0,
    transactionCount90d: 0
  };
}

function emptyAlphaFallback(): AlphaVantageFallbackData {
  return {
    companyName: null,
    sector: null,
    industry: null,
    currency: null,
    marketCap: null,
    forwardPE: null,
    forwardPEBasis: null,
    debtToEquity: null,
    profitMargin: null,
    revenueGrowth: null,
    operatingCashflow: null,
    bullishNewsCount: 0,
    bearishNewsCount: 0
  };
}

function emptyFmpFallback(): FmpFallbackData {
  return {
    companyName: null,
    sector: null,
    industry: null,
    currency: null,
    marketCap: null,
    currentPrice: null,
    forwardPE: null,
    forwardPEBasis: null,
    debtToEquity: null,
    profitMargin: null,
    revenueGrowth: null,
    articleCount: 0
  };
}

/**
 * Fetches the non-Yahoo provider signals used to enrich a market snapshot.
 *
 * @param symbol - Uppercase ticker symbol.
 * @returns External provider bundle with stable defaults.
 */
export async function fetchMarketSnapshotSignals(symbol: string): Promise<{
  macro: MacroSignals;
  finnhubMetrics: FinnhubMetrics;
  finnhubEarnings: FinnhubEarningsSnapshot;
  finnhubProfile: FinnhubCompanyProfile;
  finnhubInsider: FinnhubInsiderSignal;
  sp500Directory: Sp500Directory;
}> {
  const [
    macroResult,
    finnhubMetricsResult,
    finnhubEarningsResult,
    finnhubProfileResult,
    finnhubInsiderResult,
    sp500DirectoryResult
  ] = await Promise.allSettled([
    fetchMacroSignals(),
    fetchFinnhubMetrics(symbol),
    fetchFinnhubLatestEarnings(symbol),
    fetchFinnhubCompanyProfile(symbol),
    fetchFinnhubInsiderSignal(symbol),
    fetchSP500Directory()
  ]);

  return {
    macro: macroResult.status === "fulfilled" ? macroResult.value : emptyMacroSignals(),
    finnhubMetrics: extractFinnhubMetrics(finnhubMetricsResult.status === "fulfilled" ? finnhubMetricsResult.value : null),
    finnhubEarnings: finnhubEarningsResult.status === "fulfilled" ? finnhubEarningsResult.value : emptyFinnhubEarnings(),
    finnhubProfile: finnhubProfileResult.status === "fulfilled" ? finnhubProfileResult.value : emptyFinnhubProfile(),
    finnhubInsider: finnhubInsiderResult.status === "fulfilled" ? finnhubInsiderResult.value : emptyFinnhubInsider(),
    sp500Directory: sp500DirectoryResult.status === "fulfilled" ? sp500DirectoryResult.value : {}
  };
}

/**
 * Fetches fallback overview, sentiment, and quote-provider data used by market snapshots.
 *
 * @param symbol - Uppercase ticker symbol.
 * @param options - Controls whether overview/sentiment fallbacks are needed.
 * @returns Cross-provider fallback bundle.
 */
export async function fetchMarketSnapshotFallbacks(
  symbol: string,
  options: {
    needsOverviewFallback: boolean;
    needsSentimentFallback: boolean;
  }
): Promise<{
  avFallback: AlphaVantageFallbackData;
  fmpFallback: FmpFallbackData;
  eodhdFallback: EodhdFallbackData;
  finnhubSentiment: FinnhubSentimentSignal;
  massiveOptionFlow: MassiveOptionFlow;
  massiveShortInterest: MassiveShortInterest;
  finnhubOptionFlow: FinnhubOptionFlow;
  finnhubQuote: FinnhubQuoteSnapshot;
  alphaQuote: AlphaVantageQuoteSnapshot;
  fmpQuote: FmpQuoteSnapshot;
  eodhdQuote: EodhdQuoteSnapshot;
  massiveQuote: MassiveQuoteSnapshot;
}> {
  const shouldFetchOverview = options.needsOverviewFallback || options.needsSentimentFallback;

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
  ] = await Promise.all([
    shouldFetchOverview ? fetchAlphaVantageFallbackData(symbol) : Promise.resolve(emptyAlphaFallback()),
    shouldFetchOverview ? fetchFmpFallbackData(symbol) : Promise.resolve(emptyFmpFallback()),
    fetchEodhdFallbackData(symbol),
    fetchFinnhubSentiment(symbol),
    fetchMassiveOptionFlow(symbol),
    fetchMassiveShortInterest(symbol),
    fetchFinnhubOptionFlow(symbol),
    fetchFinnhubQuoteSnapshot(symbol),
    fetchAlphaVantageQuoteSnapshot(symbol),
    fetchFmpQuoteSnapshot(symbol),
    fetchEodhdQuoteSnapshot(symbol),
    fetchMassiveQuoteSnapshot(symbol)
  ]);

  return {
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
  };
}
