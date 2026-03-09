import { fetchMarketSnapshot } from "@/lib/market/yahoo";
import { fetchSecFundamentalsFallback } from "@/lib/market/sec-companyfacts";
import { scoreSnapshot } from "@/lib/scoring/engine";
import type { AnalysisResult } from "@/lib/types";

export async function analyzeStock(symbol: string): Promise<AnalysisResult> {
  const [snapshot, secFallback] = await Promise.all([
    fetchMarketSnapshot(symbol),
    fetchSecFundamentalsFallback(symbol)
  ]);

  const fallbackMarketCap =
    typeof secFallback.sharesOutstanding === "number" &&
    Number.isFinite(secFallback.sharesOutstanding) &&
    secFallback.sharesOutstanding > 0 &&
    snapshot.currentPrice > 0
      ? secFallback.sharesOutstanding * snapshot.currentPrice
      : null;
  const effectiveMarketCap = snapshot.marketCap ?? fallbackMarketCap;

  const snapshotWithFallback = {
    ...snapshot,
    marketCap: effectiveMarketCap,
    revenueGrowth: snapshot.revenueGrowth ?? secFallback.revenueGrowth,
    earningsQuarterlyGrowth: snapshot.earningsQuarterlyGrowth ?? secFallback.earningsQuarterlyGrowth,
    fcfYield:
      snapshot.fcfYield ??
      (typeof secFallback.ttmFreeCashflow === "number" &&
      Number.isFinite(secFallback.ttmFreeCashflow) &&
      effectiveMarketCap !== null &&
      effectiveMarketCap > 0
        ? secFallback.ttmFreeCashflow / effectiveMarketCap
        : null)
  };

  const result = scoreSnapshot(snapshotWithFallback);

  return {
    ...result,
    fundamentals: {
      ...result.fundamentals,
      trailingPE:
        result.fundamentals.trailingPE ??
        (typeof secFallback.trailingEpsTtm === "number" &&
        Number.isFinite(secFallback.trailingEpsTtm) &&
        secFallback.trailingEpsTtm > 0 &&
        snapshot.currentPrice > 0
          ? snapshot.currentPrice / secFallback.trailingEpsTtm
          : null),
      revenueGrowth: result.fundamentals.revenueGrowth ?? secFallback.revenueGrowth,
      earningsQuarterlyGrowth: result.fundamentals.earningsQuarterlyGrowth ?? secFallback.earningsQuarterlyGrowth,
      fcfYield:
        result.fundamentals.fcfYield ??
        (typeof secFallback.ttmFreeCashflow === "number" &&
        Number.isFinite(secFallback.ttmFreeCashflow) &&
        effectiveMarketCap !== null &&
        effectiveMarketCap > 0
          ? secFallback.ttmFreeCashflow / effectiveMarketCap
          : null)
    }
  };
}
