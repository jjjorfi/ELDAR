import { fetchMarketSnapshot } from "@/lib/market/yahoo";
import { toMarketSnapshot } from "@/lib/financials/eldar-financials-adapter";
import { getCompanyFinancials } from "@/lib/financials/eldar-financials-pipeline";
import { fetchSecFundamentalsFallback } from "@/lib/market/sec-companyfacts";
import { isNySessionOpen } from "@/lib/market/ny-session";
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
          console.warn(`[Analyze]: canonical SEC pipeline unavailable for ${normalizedSymbol}; using fallback bridge.`, error);
          return null;
        })
    ]);

    const secFallback =
      canonicalFundamentals === null
        ? await fetchSecFundamentalsFallback(normalizedSymbol).catch((error) => {
            console.warn(`[Analyze]: SEC bridge fallback unavailable for ${normalizedSymbol}.`, error);
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
      fallbackMarketCapFromShares;
    const effectiveMarketCap = snapshot.marketCap ?? fallbackMarketCap ?? null;

    const snapshotWithFallback = {
      ...snapshot,
      sector: snapshot.sector ?? canonicalFundamentals?.sector ?? null,
      marketCap: effectiveMarketCap,
      trailingEps: coalesceNumber(snapshot.trailingEps, canonicalFundamentals?.trailingEps, secFallback?.trailingEpsTtm),
      revenueGrowth: coalesceNumber(snapshot.revenueGrowth, canonicalFundamentals?.revenueGrowth, secFallback?.revenueGrowth),
      earningsQuarterlyGrowth: coalesceNumber(
        snapshot.earningsQuarterlyGrowth,
        canonicalFundamentals?.earningsQuarterlyGrowth,
        secFallback?.earningsQuarterlyGrowth
      ),
      debtToEquity: coalesceNumber(snapshot.debtToEquity, canonicalFundamentals?.debtToEquity),
      evEbitda: coalesceNumber(snapshot.evEbitda, canonicalFundamentals?.evEbitda),
      roic: coalesceNumber(snapshot.roic, canonicalFundamentals?.roic),
      roicTrend: coalesceNumber(snapshot.roicTrend, canonicalFundamentals?.roicTrend),
      fcfYield:
        coalesceNumber(snapshot.fcfYield, canonicalFundamentals?.fcfYield) ??
        (secFallback &&
        typeof secFallback.ttmFreeCashflow === "number" &&
        Number.isFinite(secFallback.ttmFreeCashflow) &&
        effectiveMarketCap !== null &&
        effectiveMarketCap > 0
          ? secFallback.ttmFreeCashflow / effectiveMarketCap
          : null)
    };

    const result = scoreSnapshot(snapshotWithFallback);
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
