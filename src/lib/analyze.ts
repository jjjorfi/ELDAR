import { fetchMarketSnapshot } from "@/lib/market/providers/yahoo";
import { toMarketSnapshot } from "@/lib/financials/eldar-financials-adapter";
import { getCompanyFinancials } from "@/lib/financials/eldar-financials-pipeline";
import { log } from "@/lib/logger";
import { fetchSecFundamentalsFallback } from "@/lib/market/providers/sec-companyfacts";
import { isNySessionOpen } from "@/lib/market/ny-session";
import { getTVFundamentals } from "@/lib/providers/tradingview-fundamentals";
import { scoreSnapshot } from "@/lib/scoring/engine";
import type { AnalysisResult } from "@/lib/types";

const ANALYZE_CACHE_OPEN_TTL_MS = 15_000;
const ANALYZE_CACHE_CLOSED_TTL_MS = 60_000;
const ANALYZE_CACHE_MAX_ENTRIES = 600;

const analysisCache = new Map<string, { expiresAt: number; value: AnalysisResult }>();
const analysisInFlight = new Map<string, Promise<AnalysisResult>>();

function finiteOrNull(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function coalesceNumber(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    const parsed = finiteOrNull(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function normalizeSymbolKey(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function cloneAnalysisResult(result: AnalysisResult): AnalysisResult {
  return JSON.parse(JSON.stringify(result)) as AnalysisResult;
}

function pruneAnalysisCache(nowMs: number): void {
  for (const [key, entry] of analysisCache.entries()) {
    if (entry.expiresAt <= nowMs) {
      analysisCache.delete(key);
    }
  }
  if (analysisCache.size <= ANALYZE_CACHE_MAX_ENTRIES) {
    return;
  }

  const overflow = analysisCache.size - ANALYZE_CACHE_MAX_ENTRIES;
  const keys = analysisCache.keys();
  for (let index = 0; index < overflow; index += 1) {
    const next = keys.next();
    if (next.done) break;
    analysisCache.delete(next.value);
  }
}

export async function analyzeStock(symbol: string): Promise<AnalysisResult> {
  const normalizedSymbol = normalizeSymbolKey(symbol);
  if (!normalizedSymbol) {
    throw new Error("Invalid symbol.");
  }

  const nowMs = Date.now();
  pruneAnalysisCache(nowMs);

  const cached = analysisCache.get(normalizedSymbol);
  if (cached && cached.expiresAt > nowMs) {
    return cloneAnalysisResult(cached.value);
  }

  const running = analysisInFlight.get(normalizedSymbol);
  if (running) {
    return cloneAnalysisResult(await running);
  }

  const run = (async (): Promise<AnalysisResult> => {
    const [snapshot, canonicalFundamentals] = await Promise.all([
      fetchMarketSnapshot(normalizedSymbol),
      getCompanyFinancials(normalizedSymbol)
        .then((financials) => toMarketSnapshot(financials))
        .catch((error) => {
          log({
            level: "warn",
            service: "analyze",
            message: "Canonical SEC pipeline unavailable; using fallback bridge",
            symbol: normalizedSymbol,
            error: error instanceof Error ? error.message : String(error)
          });
          return null;
        })
    ]);

    const needsTvFallback =
      canonicalFundamentals === null ||
      [
        canonicalFundamentals?.forwardPE,
        canonicalFundamentals?.revenueGrowth,
        canonicalFundamentals?.earningsQuarterlyGrowth,
        canonicalFundamentals?.fcfYield,
        canonicalFundamentals?.debtToEquity,
        canonicalFundamentals?.evEbitda,
        canonicalFundamentals?.trailingEps,
        canonicalFundamentals?.technical.sma200,
        canonicalFundamentals?.technical.rsi14
      ].some((value) => value === null);

    const tvFundamentals = needsTvFallback
      ? await getTVFundamentals(normalizedSymbol).catch((error) => {
          log({
            level: "warn",
            service: "analyze",
            message: "TradingView fundamentals fallback unavailable",
            symbol: normalizedSymbol,
            error: error instanceof Error ? error.message : String(error)
          });
          return null;
        })
      : null;

    const needsSecFallback =
      canonicalFundamentals === null &&
      (
        tvFundamentals === null ||
        [
          tvFundamentals.revenueGrowthYoYPct,
          tvFundamentals.epsGrowthYoYPct,
          tvFundamentals.freeCashFlowTTM,
          tvFundamentals.epsDilutedTTM
        ].some((value) => value === null)
      );

    const secFallback =
      needsSecFallback
        ? await fetchSecFundamentalsFallback(normalizedSymbol).catch((error) => {
            log({
              level: "warn",
              service: "analyze",
              message: "SEC bridge fallback unavailable",
              symbol: normalizedSymbol,
              error: error instanceof Error ? error.message : String(error)
            });
            return null;
          })
        : null;

    const fallbackMarketCapFromShares =
      secFallback &&
      typeof secFallback.sharesOutstanding === "number" &&
      Number.isFinite(secFallback.sharesOutstanding) &&
      secFallback.sharesOutstanding > 0 &&
      snapshot.currentPrice > 0
        ? secFallback.sharesOutstanding * snapshot.currentPrice
        : null;

    const fallbackMarketCap =
      canonicalFundamentals?.marketCap ??
      tvFundamentals?.marketCapUSD ??
      fallbackMarketCapFromShares;
    const effectiveMarketCap =
      canonicalFundamentals?.marketCap ??
      snapshot.marketCap ??
      tvFundamentals?.marketCapUSD ??
      fallbackMarketCap ??
      null;
    const effectiveForwardPE = coalesceNumber(
      canonicalFundamentals?.forwardPE,
      snapshot.forwardPE,
      tvFundamentals?.forwardPE
    );
    const effectiveForwardPEBasis: typeof snapshot.forwardPEBasis =
      effectiveForwardPE === null
        ? null
        : canonicalFundamentals?.forwardPE !== null
            ? (canonicalFundamentals?.forwardPEBasis ?? "UNKNOWN")
            : snapshot.forwardPE !== null
              ? (snapshot.forwardPEBasis ?? "UNKNOWN")
              : tvFundamentals?.forwardPE !== null
                ? "NTM"
              : "UNKNOWN";
    const effectiveTrailingEps = coalesceNumber(
      canonicalFundamentals?.trailingEps,
      snapshot.trailingEps,
      tvFundamentals?.epsDilutedTTM,
      secFallback?.trailingEpsTtm
    );
    const effectiveRevenueGrowth = coalesceNumber(
      canonicalFundamentals?.revenueGrowth,
      snapshot.revenueGrowth,
      tvFundamentals?.revenueGrowthYoYPct,
      secFallback?.revenueGrowth
    );
    const effectiveFcfYield =
      coalesceNumber(
        canonicalFundamentals?.fcfYield,
        snapshot.fcfYield,
        tvFundamentals !== null &&
          tvFundamentals.freeCashFlowTTM !== null &&
          tvFundamentals.marketCapUSD !== null &&
          tvFundamentals.marketCapUSD > 0
          ? tvFundamentals.freeCashFlowTTM / tvFundamentals.marketCapUSD
          : null
      ) ??
      (secFallback &&
      typeof secFallback.ttmFreeCashflow === "number" &&
      Number.isFinite(secFallback.ttmFreeCashflow) &&
      effectiveMarketCap !== null &&
      effectiveMarketCap > 0
        ? secFallback.ttmFreeCashflow / effectiveMarketCap
        : null);
    const effectiveDebtToEquity = coalesceNumber(
      canonicalFundamentals?.debtToEquity,
      snapshot.debtToEquity,
      tvFundamentals?.debtToEquity
    );
    const effectiveEvEbitda = coalesceNumber(
      canonicalFundamentals?.evEbitda,
      snapshot.evEbitda,
      tvFundamentals?.evEbitda
    );
    const effectiveRoic = coalesceNumber(
      canonicalFundamentals?.roic,
      snapshot.roic,
      tvFundamentals?.roicPct
    );
    const effectiveRoicTrend = coalesceNumber(canonicalFundamentals?.roicTrend, snapshot.roicTrend);
    const effectiveEarningsQuarterlyGrowth = coalesceNumber(
      canonicalFundamentals?.earningsQuarterlyGrowth,
      snapshot.earningsQuarterlyGrowth,
      tvFundamentals?.epsGrowthYoYPct,
      secFallback?.earningsQuarterlyGrowth
    );
    const effectiveEarningsGrowthBasis: typeof snapshot.earningsGrowthBasis =
      effectiveEarningsQuarterlyGrowth === null
        ? null
        : canonicalFundamentals?.earningsQuarterlyGrowth !== null
          ? (canonicalFundamentals?.earningsGrowthBasis ?? "UNKNOWN")
          : snapshot.earningsQuarterlyGrowth !== null
            ? (snapshot.earningsGrowthBasis ?? "UNKNOWN")
            : tvFundamentals?.epsGrowthYoYPct !== null
              ? "YOY"
            : secFallback?.earningsQuarterlyGrowth !== null
              ? "YOY"
              : "UNKNOWN";

    const snapshotWithFallback = {
      ...snapshot,
      currentPrice: coalesceNumber(snapshot.currentPrice, tvFundamentals?.priceClose) ?? snapshot.currentPrice,
      sector: canonicalFundamentals?.sector ?? snapshot.sector ?? null,
      marketCap: effectiveMarketCap,
      forwardPE: effectiveForwardPE,
      forwardPEBasis: effectiveForwardPEBasis,
      trailingEps: effectiveTrailingEps,
      revenueGrowth: effectiveRevenueGrowth,
      earningsQuarterlyGrowth: effectiveEarningsQuarterlyGrowth,
      earningsGrowthBasis: effectiveEarningsGrowthBasis,
      debtToEquity: effectiveDebtToEquity,
      evEbitda: effectiveEvEbitda,
      roic: effectiveRoic,
      roicTrend: effectiveRoicTrend,
      fcfYield: effectiveFcfYield,
      technical: {
        ...snapshot.technical,
        sma200: coalesceNumber(snapshot.technical.sma200, tvFundamentals?.sma200),
        rsi14: coalesceNumber(snapshot.technical.rsi14, tvFundamentals?.rsi14)
      }
    };

    const result: AnalysisResult = scoreSnapshot(snapshotWithFallback);

    const ttlMs = isNySessionOpen() ? ANALYZE_CACHE_OPEN_TTL_MS : ANALYZE_CACHE_CLOSED_TTL_MS;
    analysisCache.set(normalizedSymbol, {
      expiresAt: Date.now() + ttlMs,
      value: cloneAnalysisResult(result)
    });
    return result;
  })().finally(() => {
    analysisInFlight.delete(normalizedSymbol);
  });

  analysisInFlight.set(normalizedSymbol, run);
  return cloneAnalysisResult(await run);
}
